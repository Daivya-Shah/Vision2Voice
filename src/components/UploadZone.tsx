import { useCallback, useState } from "react";
import { Upload, Film } from "lucide-react";

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

const UploadZone = ({ onFileSelect, isProcessing }: UploadZoneProps) => {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith("video/")) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onFileSelect(file);
    },
    [onFileSelect]
  );

  if (isProcessing) return null;

  return (
    <div
      className={`relative mx-auto max-w-2xl rounded-2xl border-2 border-dashed p-16 text-center transition-all duration-300 cursor-pointer ${
        isDragOver
          ? "border-primary bg-primary/5 glow-primary"
          : "border-border hover:border-primary/50 hover:bg-card/50"
      }`}
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
      <div className="flex flex-col items-center gap-4">
        <div className="rounded-2xl bg-primary/10 p-5">
          {isDragOver ? (
            <Film className="h-12 w-12 text-primary" />
          ) : (
            <Upload className="h-12 w-12 text-primary" />
          )}
        </div>
        <div>
          <p className="font-display text-2xl font-bold text-foreground">
            Drop your basketball clip here
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            MP4 files supported · Drag & drop or click to browse
          </p>
        </div>
      </div>
    </div>
  );
};

export default UploadZone;
