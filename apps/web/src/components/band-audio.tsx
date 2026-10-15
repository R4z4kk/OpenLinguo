import { DownloadControls } from "@/components/download-controls";
import {
  bandBytes,
  bandId,
  fetchWithProgress,
  installBand,
  removeBand,
  type BandState,
} from "@/data/audio-packs";
import { database } from "@/data/database";
import type { AudioPackBand } from "@/data/format";

/** Downloads, cancels or deletes a band's word audio. */
export const BandAudio = ({
  release,
  band,
  state,
  describedBy,
  onChange,
}: {
  readonly release: string;
  readonly band: AudioPackBand;
  readonly state: BandState;
  /** The band's heading. */
  readonly describedBy: string;
  readonly onChange: () => void;
}) => (
  <DownloadControls
    labels="audio"
    bytes={bandBytes(band)}
    state={state}
    describedBy={describedBy}
    install={(onProgress, signal) =>
      installBand(database, release, band, fetchWithProgress, onProgress, signal)
    }
    remove={() => removeBand(database, bandId(band))}
    onChange={onChange}
  />
);
