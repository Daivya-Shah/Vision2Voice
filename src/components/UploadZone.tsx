import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { Marker } from "@/components/almanac";

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

const UploadZone = ({ onFileSelect, isProcessing }: UploadZoneProps) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [hover, setHover] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("video/")) {
        onFileSelect(file);
      }
    },
    [onFileSelect],
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect],
  );

  if (isProcessing) return null;

  return (
    <div
      className={cn(
        "group relative w-full cursor-pointer select-none border bg-transparent transition-colors",
        isDragOver
          ? "border-court bg-court/5"
          : hover
            ? "border-foreground"
            : "border-foreground/40",
      )}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => document.getElementById("file-input")?.click()}
    >
      <input
        id="file-input"
        type="file"
        accept="video/mp4,video/*"
        className="hidden"
        onChange={handleFileInput}
      />

      <div className="absolute left-3 top-3">
        <Marker tone={isDragOver ? "accent" : "muted"}>FIG.01 / DROP CLIP</Marker>
      </div>
      <div className="absolute right-3 top-3">
        <Marker tone="muted">MP4 · MOV · WEBM</Marker>
      </div>
      <div className="absolute bottom-3 left-3">
        <Marker tone="muted">{isDragOver ? "› RELEASE TO COMMIT" : "CLICK OR DRAG"}</Marker>
      </div>
      <div className="absolute bottom-3 right-3">
        <Marker tone="muted">REC ●</Marker>
      </div>

      <div className="flex min-h-[320px] flex-col items-center justify-center gap-6 px-6 py-20 text-center">
        <p className="font-display text-[64px] leading-[0.85] text-foreground sm:text-[88px] md:text-[112px]">
          DROP THE
          <br />
          <span className={cn("transition-colors", isDragOver ? "text-court" : "text-foreground")}>
            CLIP
          </span>
        </p>
        <p className="max-w-md font-body text-sm italic text-foreground/60">
          A single basketball play. The desk will read it, retrieve the box score, and write the call.
        </p>
      </div>
    </div>
  );
};

export default UploadZone;
