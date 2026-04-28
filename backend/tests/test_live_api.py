import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

import main


class LiveApiTests(unittest.TestCase):
    def test_live_upload_accepts_raw_video_body(self):
        client = TestClient(main.app)
        response = client.post(
            "/live/uploads?filename=test.mp4",
            content=b"fake mp4 bytes",
            headers={"Content-Type": "video/mp4"},
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["filename"], "test.mp4")
        self.assertEqual(payload["size_bytes"], len(b"fake mp4 bytes"))
        self.assertIn("/live/uploads/", payload["file_url"])

        video = client.get(payload["file_url"])
        self.assertEqual(video.status_code, 200)
        self.assertEqual(video.content, b"fake mp4 bytes")

    def test_live_playback_control_forwards_media_clock(self):
        client = TestClient(main.app)
        with patch.object(main.live_sessions, "control_playback", AsyncMock(return_value=True)) as control:
            response = client.post(
                "/live/sessions/session-1/playback",
                json={"state": "paused", "replay_time_sec": 12.5, "playback_rate": 1.25},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "paused"})
        control.assert_awaited_once_with(
            "session-1",
            state="paused",
            replay_time_sec=12.5,
            playback_rate=1.25,
        )


if __name__ == "__main__":
    unittest.main()
