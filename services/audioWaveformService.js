import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_DIR = path.join(__dirname, '..');
const UPLOADS_DIR = path.join(BACKEND_DIR, 'uploads');
const WAVEFORMS_DIR = path.join(UPLOADS_DIR, 'waveforms');
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

  async generateForUpload(fileData, options = {}) {
    if (!fileData?.filename) return null;

    const inputPath = path.join(UPLOADS_DIR, fileData.filename);
    if (!fs.existsSync(inputPath)) {
      throw new Error(`No se encontro el archivo para generar waveform: ${fileData.filename}`);
    }

    const baseName = path.parse(fileData.filename).name;
    const outputFilename = `${baseName}.waveform.json`;
    const outputPath = path.join(WAVEFORMS_DIR, outputFilename);
    const pointCount = Number(options.points) || 800;
    const { command, baseArgs } = this.getPythonCommand();

    const stdout = await runPython(command, [
      ...baseArgs,
      SCRIPT_PATH,
      inputPath,
      '--points',
      String(pointCount),
    ]);

    const waveform = JSON.parse(stdout.trim());
    fs.writeFileSync(outputPath, JSON.stringify(waveform));

    return `/uploads/waveforms/${outputFilename}`;
  }
}

export default new AudioWaveformService();
