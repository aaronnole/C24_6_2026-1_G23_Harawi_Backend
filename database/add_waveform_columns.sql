ALTER TABLE files
  ADD COLUMN IF NOT EXISTS waveform_url TEXT;

ALTER TABLE musical_archives
  ADD COLUMN IF NOT EXISTS waveform_url TEXT;
