"""Merge commentary TTS (OpenAI) onto a video using FFmpeg (bundled via imageio-ffmpeg)."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import httpx
import imageio_ffmpeg

logger = logging.getLogger("vision2voice.voiceover")

# If measured audio is longer than video * (1 + tol), time-compress with atempo so the full script fits.
_AUDIO_LONGER_TOLERANCE = 0.03


def _voiceover_playback_speed() -> float:
    try:
        s = float(os.getenv("VOICEOVER_PLAYBACK_SPEED", "1.5"))
    except ValueError:
        s = 1.5
    return max(1.0, min(s, 2.0))


def _fit_audio_filter_inner(audio_dur: float, target_sec: float) -> str:
    """Filter chain (no [1:a] prefix) mapping input audio to exactly target_sec seconds."""
    ts = max(0.05, float(target_sec))
    dur_s = f"{ts:.3f}"
    if audio_dur <= ts * (1.0 + _AUDIO_LONGER_TOLERANCE):
        p = audio_dur / ts if ts > 0 else 1.0
        chain = _atempo_chain_product(p)
        if chain:
            return f"{chain},apad=whole_dur={dur_s},atrim=0:{dur_s}"
        return f"apad=whole_dur={dur_s},atrim=0:{dur_s}"
    speedup = audio_dur / ts
    chain = _atempo_chain(speedup)
    if chain:
        return f"{chain},apad=whole_dur={dur_s},atrim=0:{dur_s}"
    return f"apad=whole_dur={dur_s},atrim=0:{dur_s}"


def _tts_to_mp3_sync(text: str, out_mp3: str) -> None:
    from openai import OpenAI

    from openai_retry import with_openai_retry_sync

    t = (text or "").strip()[:3800] or "No commentary."
    client = OpenAI()
    voice = os.getenv("OPENAI_TTS_VOICE", "onyx")
    model = os.getenv("OPENAI_TTS_MODEL", "tts-1")

    def _speech():
        return client.audio.speech.create(model=model, voice=voice, input=t, response_format="mp3")

    resp = with_openai_retry_sync(_speech, label="tts")
    resp.stream_to_file(out_mp3)


async def commentary_to_mp3(text: str, out_mp3: str) -> None:
    await asyncio.to_thread(_tts_to_mp3_sync, text, out_mp3)


def _probe_duration_seconds(media_path: str) -> float:
    """Read container duration via ffmpeg stderr (works for mp4/mp3 without ffprobe)."""
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    r = subprocess.run(
        [ffmpeg, "-hide_banner", "-i", media_path],
        capture_output=True,
        text=True,
    )
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.?\d*)", r.stderr)
    if not m:
        raise RuntimeError("Could not read media duration for voiceover sync")
    h, mi, s = int(m.group(1)), int(m.group(2)), float(m.group(3))
    return max(0.05, h * 3600 + mi * 60 + s)


def _atempo_chain_product(p: float) -> str:
    """
    Chain FFmpeg atempo filters so the product of factors equals `p`.
    Output duration = input_duration / p. FFmpeg allows each atempo in [0.5, 2.0].
    Use p = audio_dur / target_dur: p>1 speeds up (shorter), p<1 slows down (longer).
    """
    if p <= 0:
        return ""
    if abs(p - 1.0) < 0.008:
        return ""
    parts: list[str] = []
    rem = float(p)
    if rem > 1.0:
        for _ in range(32):
            if rem <= 1.001:
                break
            step = min(rem, 2.0)
            parts.append(f"atempo={step:.6f}".rstrip("0").rstrip("."))
            rem /= step
    else:
        for _ in range(32):
            if rem >= 0.999:
                break
            step = max(rem, 0.5)
            parts.append(f"atempo={step:.6f}".rstrip("0").rstrip("."))
            rem /= step
    return ",".join(parts)


def _atempo_chain(speedup: float) -> str:
    """Backward name: speedup factor = audio_duration / video_duration (>1 = compress to fit)."""
    return _atempo_chain_product(float(speedup))


def merge_video_with_commentary_audio(
    video_path: str,
    commentary_mp3: str,
    out_mp4: str,
    video_duration_sec: float,
    *,
    apply_playback_speed: bool = True,
) -> None:
    """
    Mux narration onto video. When apply_playback_speed (default): fit TTS to
    video_duration * VOICEOVER_PLAYBACK_SPEED (natural speaking slot), then apply
    atempo so playback is that many times faster, ending exactly at video length
    (e.g. speed 1.5 → 10.5s of fitted speech for a 7s clip, played 1.5x → 7s).
    When False (timeline export): audio is already timed to the video; only trim/pad to vd.
    """
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    vd = max(0.1, float(video_duration_sec))
    dur_s = f"{vd:.3f}"
    audio_dur = _probe_duration_seconds(commentary_mp3)
    speed = _voiceover_playback_speed() if apply_playback_speed else 1.0
    natural_target = vd * speed if apply_playback_speed else vd
    logger.info(
        "Voiceover sync: video=%.3fs, tts_audio=%.3fs, playback_speed=%.2fx, natural_target=%.3fs",
        vd,
        audio_dur,
        speed,
        natural_target,
    )

    inner = _fit_audio_filter_inner(audio_dur, natural_target)
    if apply_playback_speed and speed > 1.02:
        sc = _atempo_chain_product(speed)
        if sc:
            filt = f"[1:a]{inner},{sc},atrim=0:{dur_s},asetpts=PTS-STARTPTS[aout]"
            logger.info("Applied %.2fx playback speedup after fitting to natural slot", speed)
        else:
            filt = f"[1:a]{inner},atrim=0:{dur_s},asetpts=PTS-STARTPTS[aout]"
    else:
        filt = f"[1:a]{inner},asetpts=PTS-STARTPTS[aout]"

    cmd = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        video_path,
        "-i",
        commentary_mp3,
        "-filter_complex",
        filt,
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-t",
        dur_s,
        "-movflags",
        "+faststart",
        out_mp4,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        logger.error("ffmpeg failed: %s", proc.stderr or proc.stdout)
        raise RuntimeError(proc.stderr or proc.stdout or "ffmpeg failed")


async def download_video_temp(file_url: str) -> str:
    async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
        r = await client.get(file_url)
        r.raise_for_status()
        content = r.content
    fd, path = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    Path(path).write_bytes(content)
    return path


async def build_voiceover_mp4(file_url: str, commentary_text: str) -> str:
    """
    Download clip, synthesize speech, mux into a new MP4. Returns path to temp .mp4 (caller deletes).
    """
    vid_path = await download_video_temp(file_url)
    mp3_fd, mp3_path = tempfile.mkstemp(suffix=".mp3")
    os.close(mp3_fd)
    out_fd, out_path = tempfile.mkstemp(suffix=".mp4")
    os.close(out_fd)
    try:
        # Same probe as audio so mux length matches what ffmpeg sees for the container
        dur = await asyncio.to_thread(_probe_duration_seconds, vid_path)
        await commentary_to_mp3(commentary_text, mp3_path)
        await asyncio.to_thread(merge_video_with_commentary_audio, vid_path, mp3_path, out_path, dur)
        return out_path
    except Exception:
        try:
            os.remove(out_path)
        except OSError:
            pass
        raise
    finally:
        for p in (vid_path, mp3_path):
            try:
                os.remove(p)
            except OSError:
                pass


def _ffmpeg_adjust_segment_to_duration(
    in_audio: str,
    wall_duration_sec: float,
    out_wav: str,
    *,
    playback_speed: float = 1.0,
) -> None:
    """
    Fit TTS to wall_duration * playback_speed (natural slot), then speed up by playback_speed
    so the result lasts exactly wall_duration (WAV PCM for concat).
    """
    ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
    wall = max(0.08, float(wall_duration_sec))
    speed = max(1.0, float(playback_speed))
    natural = wall * speed if speed > 1.02 else wall
    wall_s = f"{wall:.3f}"
    ad = _probe_duration_seconds(in_audio)
    inner = _fit_audio_filter_inner(ad, natural)
    if speed > 1.02:
        sc = _atempo_chain_product(speed)
        if sc:
            af = f"{inner},{sc},atrim=0:{wall_s},asetpts=PTS-STARTPTS"
        else:
            af = f"{inner},atrim=0:{wall_s},asetpts=PTS-STARTPTS"
    else:
        af = f"{inner},asetpts=PTS-STARTPTS"
    cmd = [
        ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        in_audio,
        "-af",
        af,
        "-acodec",
        "pcm_s16le",
        "-ar",
        "44100",
        "-ac",
        "2",
        out_wav,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        logger.error("ffmpeg segment adjust failed: %s", proc.stderr or proc.stdout)
        raise RuntimeError(proc.stderr or proc.stdout or "ffmpeg segment failed")


async def build_voiceover_timeline_mp4(
    file_url: str,
    segments: list[dict[str, Any]],
    lines: list[str],
) -> str:
    """
    TTS per timeline segment, time-stretch each piece to (t1-t0)*video_duration, concat, mux.
    """
    n = len(segments)
    if n == 0 or len(lines) != n:
        raise ValueError("segments and lines must be same non-empty length")

    vid_path = await download_video_temp(file_url)
    out_fd, out_path = tempfile.mkstemp(suffix=".mp4")
    os.close(out_fd)
    piece_paths: list[str] = []
    tmp_mp3s: list[str] = []
    list_path = ""
    timeline_wav = ""
    try:
        vd = await asyncio.to_thread(_probe_duration_seconds, vid_path)
        for i in range(n):
            seg = segments[i]
            t0 = float(seg.get("t0", 0))
            t1 = float(seg.get("t1", 1))
            span = max(0.0, min(1.0, t1) - max(0.0, min(1.0, t0)))
            piece_dur = max(0.12, span * vd)
            fd, mp3 = tempfile.mkstemp(suffix=".mp3")
            os.close(fd)
            tmp_mp3s.append(mp3)
            await commentary_to_mp3(lines[i], mp3)
            fd2, wav = tempfile.mkstemp(suffix=".wav")
            os.close(fd2)
            piece_paths.append(wav)
            await asyncio.to_thread(
                _ffmpeg_adjust_segment_to_duration,
                mp3,
                piece_dur,
                wav,
                playback_speed=_voiceover_playback_speed(),
            )

        list_fd, list_path = tempfile.mkstemp(suffix=".txt")
        os.close(list_fd)
        with open(list_path, "w", encoding="utf-8") as lf:
            for wp in piece_paths:
                ap = Path(wp).resolve().as_posix().replace("'", "'\\''")
                lf.write(f"file '{ap}'\n")

        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        fd3, timeline_wav = tempfile.mkstemp(suffix=".wav")
        os.close(fd3)
        concat_cmd = [
            ffmpeg,
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            list_path,
            "-c",
            "copy",
            timeline_wav,
        ]
        proc_c = subprocess.run(concat_cmd, capture_output=True, text=True)
        if proc_c.returncode != 0:
            logger.error("ffmpeg concat failed: %s", proc_c.stderr or proc_c.stdout)
            raise RuntimeError(proc_c.stderr or proc_c.stdout or "concat failed")

        tl_dur = await asyncio.to_thread(_probe_duration_seconds, timeline_wav)
        if abs(tl_dur - vd) > 0.15:
            logger.warning("Timeline audio duration %.3fs vs video %.3fs — minor drift", tl_dur, vd)

        await asyncio.to_thread(
            merge_video_with_commentary_audio,
            vid_path,
            timeline_wav,
            out_path,
            vd,
            apply_playback_speed=False,
        )
        return out_path
    except Exception:
        try:
            os.remove(out_path)
        except OSError:
            pass
        raise
    finally:
        try:
            os.remove(vid_path)
        except OSError:
            pass
        for p in tmp_mp3s:
            try:
                os.remove(p)
            except OSError:
                pass
        for p in piece_paths:
            try:
                os.remove(p)
            except OSError:
                pass
        if list_path:
            try:
                os.remove(list_path)
            except OSError:
                pass
        if timeline_wav:
            try:
                os.remove(timeline_wav)
            except OSError:
                pass
