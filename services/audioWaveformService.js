import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.join(__dirname, '..');
const SCRIPT_PATH = path.join(BACKEND_DIR, 'scripts', 'generate_waveform.py');
const DEFAULT_PYTHON_312 = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python', 'Python312', 'python.exe')
  : null;

function runPython(command, args) {
  const pythonCommand = command || process.env.PYTHON_BIN || 'python';

  return new Promise((resolve, reject) => {
    const child = spawn(pythonCommand, args, { cwd: BACKEND_DIR });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || `Python finalizo con codigo ${code}`));
    });
  });
}

class AudioWaveformService {
  isAudio(file) {
    return Boolean(file?.mimetype?.startsWith('audio/'));
  }

  getPythonCommand() {
    if (process.env.PYTHON_BIN) {
      return { command: process.env.PYTHON_BIN, baseArgs: [] };
    }

    if (DEFAULT_PYTHON_312 && fs.existsSync(DEFAULT_PYTHON_312)) {
      return { command: DEFAULT_PYTHON_312, baseArgs: [] };
    }

    return { command: 'python', baseArgs: [] };
  }

  async generateForUpload(file, options = {}) {
    if (!file?.buffer || !file?.originalname) return null;

    const pointCount = Number(options.points) || 800;
    const { command, baseArgs } = this.getPythonCommand();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harawi-waveform-'));
    const inputFilename = `${Date.now()}-${path.basename(file.originalname)}`;
    const inputPath = path.join(tempDir, inputFilename);
    const baseName = path.parse(file.originalname).name;
    const outputFilename = `${baseName}.waveform.json`;

    try {
      fs.writeFileSync(inputPath, file.buffer);

      let stdout;
      try {
        stdout = await runPython(command, [
          ...baseArgs,
          SCRIPT_PATH,
          inputPath,
          '--points',
          String(pointCount),
        ]);
      } catch (error) {
        console.warn('No se pudo generar waveform para el audio:', error.message);
        return null;
      }

      let waveform;
      try {
        waveform = JSON.parse(stdout.trim());
      } catch (error) {
        console.warn('El script de waveform no devolvio JSON valido:', error.message);
        return null;
      }
      const waveformBuffer = Buffer.from(JSON.stringify(waveform));

      if (options.storageService) {
        const uploadedWaveform = await options.storageService.uploadGeneratedFile({
          buffer: waveformBuffer,
          originalName: outputFilename,
          mimetype: 'application/json',
          folder: options.folder || 'waveforms',
        });

        return uploadedWaveform.url;
      }

      const outputDir = path.join(BACKEND_DIR, 'uploads', options.folder || 'waveforms');
      const outputPath = path.join(outputDir, outputFilename);
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(outputPath, waveformBuffer);

      return `/uploads/${(options.folder || 'waveforms').replace(/\\/g, '/')}/${outputFilename}`;
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

export default new AudioWaveformService();
