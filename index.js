import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import pool from './db.js';
import dotenv from 'dotenv';
import crypto from 'crypto';
import transporter from './mailer.js';
import multer from 'multer';
import storageService from './services/storageService.js';
import audioWaveformService from './services/audioWaveformService.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Servir archivos estáticos de la carpeta uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configuración de Multer (Almacenamiento temporal en memoria para procesar con storageService)
const upload = multer({ storage: multer.memoryStorage() });

// Endpoint de Registro
app.post('/api/register', async (req, res) => {
  const {
    first_name,
    last_name,
    username,
    email,
    password,
    country,
    city,
    type_user,
    birth_date
  } = req.body;

  try {
    // 1. Verificar si el usuario ya existe
    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ message: 'El correo electrónico ya está registrado' });
    }

    // 2. Validar longitud de contraseña
    if (!password || password.length < 8) {
      return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
    }

    // 3. Encriptar contraseña
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // 3. Generar token de verificación
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // 4. Insertar en la base de datos (is_verified es false por defecto)
    const newUser = await pool.query(
      `INSERT INTO users 
      (first_name, last_name, username, email, password, country, city, type_user, birth_date, verification_token) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
      RETURNING user_id, email, username, type_user, verification_token`,
      [first_name, last_name, username, email, hashedPassword, country, city, type_user, birth_date, verificationToken]
    );

    // 5. Enviar correo de verificación
    const verificationLink = `http://localhost:3001/api/verify/${verificationToken}`;
    
    const mailOptions = {
      from: `"Harawi Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Verifica tu cuenta en Harawi',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
          <h2 style="color: #2ecc71; text-align: center;">¡Bienvenido a Harawi!</h2>
          <p>Hola <strong>${first_name}</strong>,</p>
          <p>Gracias por registrarte. Para completar tu registro y activar tu cuenta, por favor haz clic en el siguiente botón:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationLink}" style="background-color: #2ecc71; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Verificar mi correo</a>
          </div>
          <p>O copia y pega este enlace en tu navegador:</p>
          <p style="color: #888; font-size: 0.9rem;">${verificationLink}</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 0.8rem; color: #aaa; text-align: center;">Si no creaste esta cuenta, puedes ignorar este correo.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user: newUser.rows[0]
    });

  } catch (error) {
    console.error('Error en el registro:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

// Endpoint de Login Manual
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // 1. Buscar el usuario por email
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // 2. Verificar si la cuenta está activada
    if (!user.is_verified) {
      return res.status(403).json({ message: 'Por favor, verifica tu correo electrónico antes de iniciar sesión.' });
    }

    // 3. Comparar contraseña encriptada
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Credenciales inválidas' });
    }

    // 4. Verificar si es label y si necesita completar datos de sello
    let needsLabelOnboarding = false;
    let needsArtistOnboarding = false;
    
    if (user.type_user === 'label') {
      const labelCheck = await pool.query('SELECT * FROM record_label WHERE user_id = $1', [user.user_id]);
      if (labelCheck.rows.length === 0) {
        needsLabelOnboarding = true;
      }
    } else if (user.type_user === 'artist') {
      const artistCheck = await pool.query('SELECT * FROM user_instrument WHERE user_id = $1', [user.user_id]);
      if (artistCheck.rows.length === 0) {
        needsArtistOnboarding = true;
      }
    }

    // 5. Responder con datos del usuario
    res.status(200).json({
      message: 'Login exitoso',
      needsLabelOnboarding,
      needsArtistOnboarding,
      user: {
        user_id: user.user_id,
        email: user.email,
        username: user.username,
        last_name: user.last_name,
        type_user: user.type_user,
        profile_picture_url: user.profile_picture_url,
        cover_picture_url: user.cover_picture_url
      }
    });

  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Endpoint de Solicitud de Recuperación de Contraseña
app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      // Respuesta genérica por seguridad (no revelar si el email existe)
      return res.status(200).json({ message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.' });
    }

    // Generar token de restablecimiento
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Guardar token en el campo verification_token (reutilizamos la columna)
    await pool.query(
      'UPDATE users SET verification_token = $1 WHERE user_id = $2',
      [resetToken, user.user_id]
    );

    const resetLink = `http://localhost:5173/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: `"Harawi Support" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Restablecer contraseña - Harawi',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #ddd; padding: 20px; border-radius: 10px;">
          <h2 style="color: #2ecc71; text-align: center;">Restablecer Contraseña</h2>
          <p>Hola <strong>${user.first_name}</strong>,</p>
          <p>Recibimos una solicitud para restablecer tu contraseña. Haz clic en el siguiente botón:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetLink}" style="background-color: #2ecc71; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold;">Restablecer Contraseña</a>
          </div>
          <p>Si no solicitaste este cambio, puedes ignorar este correo.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 0.8rem; color: #aaa; text-align: center;">Este enlace es de un solo uso.</p>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ message: 'Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.' });

  } catch (error) {
    console.error('Error en forgot-password:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Endpoint de Restablecimiento de Contraseña
app.post('/api/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ message: 'La contraseña debe tener al menos 8 caracteres.' });
    }

    const result = await pool.query('SELECT * FROM users WHERE verification_token = $1', [token]);
    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ message: 'El enlace es inválido o ya fue utilizado.' });
    }

    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    await pool.query(
      'UPDATE users SET password = $1, verification_token = NULL WHERE user_id = $2',
      [hashedPassword, user.user_id]
    );

    res.status(200).json({ message: 'Contraseña actualizada exitosamente.' });

  } catch (error) {
    console.error('Error en reset-password:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.post('/api/record-label', async (req, res) => {
  const { user_id, label_name, ruc, company_name } = req.body;

  try {
    const newRecordLabel = await pool.query(
      `INSERT INTO record_label (user_id, label_name, ruc, company_name) 
       VALUES ($1, $2, $3, $4) 
       RETURNING *`,
      [user_id, label_name, ruc, company_name]
    );

    res.status(201).json({
      message: 'Datos del sello discográfico guardados exitosamente',
      record_label: newRecordLabel.rows[0]
    });
  } catch (error) {
    console.error('Error guardando record_label:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.post('/api/user-instruments', async (req, res) => {
  const { user_id, instruments } = req.body;

  if (!user_id || !instruments || !Array.isArray(instruments)) {
    return res.status(400).json({ message: 'Datos inválidos' });
  }

  try {
    // 1. Empezar una transacción
    await pool.query('BEGIN');

    // 2. Limpiar instrumentos anteriores del usuario (opcional, por si edita)
    await pool.query('DELETE FROM user_instrument WHERE user_id = $1', [user_id]);

    // 3. Obtener los IDs de los instrumentos a partir de sus nombres
    const instrumentIds = [];
    for (const instName of instruments) {
      const result = await pool.query('SELECT instrument_id FROM instrument WHERE name = $1', [instName]);
      if (result.rows.length > 0) {
        instrumentIds.push(result.rows[0].instrument_id);
      }
    }

    // 4. Insertar las nuevas relaciones
    for (const instId of instrumentIds) {
      await pool.query(
        'INSERT INTO user_instrument (user_id, instrument_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [user_id, instId]
      );
    }

    // 5. Confirmar transacción
    await pool.query('COMMIT');

    res.status(200).json({ message: 'Instrumentos guardados exitosamente' });
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error('Error guardando user_instruments:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Endpoint de Google Login
app.post('/api/google-login', async (req, res) => {
  const { token } = req.body;

  try {
    // 1. Obtener información del usuario desde Google usando el access_token
    const googleResponse = await fetch(`https://www.googleapis.com/oauth2/v3/userinfo?access_token=${token}`);
    const googleUser = await googleResponse.json();

    if (!googleUser.email) {
      return res.status(400).json({ message: 'Token de Google inválido' });
    }

    const { email, given_name, family_name, sub: google_id } = googleUser;

    // 2. Verificar si el usuario ya existe por google_id o email
    const userResult = await pool.query('SELECT * FROM users WHERE google_id = $1 OR email = $2', [google_id, email]);
    let user = userResult.rows[0];

    if (!user) {
      // 3. Si no existe, crearlo
      const username = email.split('@')[0] + Math.floor(Math.random() * 1000);

      const newUser = await pool.query(
        `INSERT INTO users 
        (first_name, last_name, username, email, password, type_user, google_id, is_verified) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
        RETURNING *`,
        [given_name || 'Google', family_name || 'User', username, email, 'oauth_token_placeholder', 'artist', google_id, true]
      );
      user = newUser.rows[0];
    } else if (!user.google_id) {
      // Si el usuario ya existía por email pero no tenía google_id, actualizarlo y marcar como verificado
      await pool.query('UPDATE users SET google_id = $1, is_verified = true WHERE user_id = $2', [google_id, user.user_id]);
      user.google_id = google_id;
      user.is_verified = true;
    }

    // 4. Verificar si faltan datos importantes
    const needsOnboarding = !user.country || !user.city || !user.birth_date;

    // 5. Verificar si es label o artist y si necesita completar datos
    let needsLabelOnboarding = false;
    let needsArtistOnboarding = false;

    if (user.type_user === 'label') {
      const labelCheck = await pool.query('SELECT * FROM record_label WHERE user_id = $1', [user.user_id]);
      if (labelCheck.rows.length === 0) {
        needsLabelOnboarding = true;
      }
    } else if (user.type_user === 'artist') {
      const artistCheck = await pool.query('SELECT * FROM user_instrument WHERE user_id = $1', [user.user_id]);
      if (artistCheck.rows.length === 0) {
        needsArtistOnboarding = true;
      }
    }

    res.status(200).json({
      message: 'Autenticación exitosa',
      needsOnboarding,
      needsLabelOnboarding,
      needsArtistOnboarding,
      user: {
        user_id: user.user_id,
        email: user.email,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        type_user: user.type_user,
        country: user.country,
        city: user.city,
        birth_date: user.birth_date,
        profile_picture_url: user.profile_picture_url,
        cover_picture_url: user.cover_picture_url
      }
    });

  } catch (error) {
    console.error('Error en Google Login:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

// Endpoint para actualizar el perfil (Onboarding)
app.put('/api/update-profile', async (req, res) => {
  const { user_id, type_user, country, city, birth_date } = req.body;

  try {
    const updatedUser = await pool.query(
      `UPDATE users 
       SET type_user = $1, country = $2, city = $3, birth_date = $4 
       WHERE user_id = $5 
       RETURNING *`,
      [type_user, country, city, birth_date, user_id]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.status(200).json({
      message: 'Perfil actualizado exitosamente',
      user: updatedUser.rows[0]
    });
  } catch (error) {
    console.error('Error actualizando perfil:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Endpoint de Verificación de Correo
app.get('/api/verify/:token', async (req, res) => {
  const { token } = req.params;

  try {
    // 1. Buscar usuario con el token
    const result = await pool.query('SELECT * FROM users WHERE verification_token = $1', [token]);
    const user = result.rows[0];

    if (!user) {
      return res.status(400).send(`
        <div style="text-align: center; margin-top: 50px; font-family: Arial;">
          <h2 style="color: #e74c3c;">Enlace inválido o expirado</h2>
          <p>No pudimos verificar tu cuenta. Por favor intenta registrarte de nuevo.</p>
        </div>
      `);
    }

    // 2. Marcar como verificado y limpiar el token
    await pool.query(
      'UPDATE users SET is_verified = true, verification_token = NULL WHERE user_id = $1',
      [user.user_id]
    );

    // 3. Respuesta simple
    res.send(`
      <div style="text-align: center; margin-top: 100px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <div style="font-size: 50px;">✅</div>
        <h2 style="color: #2ecc71; margin-top: 20px;">¡Cuenta Verificada!</h2>
        <p style="color: #555; font-size: 1.1rem;">Tu correo ha sido validado correctamente.</p>
        <p style="color: #888; margin-top: 30px;">Ya puedes cerrar esta pestaña y volver a la aplicación para iniciar sesión.</p>
      </div>
    `);

  } catch (error) {
    console.error('Error verificando correo:', error);
    res.status(500).send('Error interno del servidor');
  }
});

// --- ENDPOINTS DE ARCHIVOS ---

/**
 * Endpoint para subir archivos
 * Se espera un campo 'file' en el form-data y opcionalmente 'user_id'
 */
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se subió ningún archivo' });
    }

    const { user_id } = req.body; // Opcional: ID del usuario que sube el archivo

    // 1. Guardar archivo físicamente (Local o S3)
    const fileData = await storageService.uploadFile(req.file);
    let waveformUrl = null;
    if (audioWaveformService.isAudio(req.file) && fileData.storageType === 'local') {
      waveformUrl = await audioWaveformService.generateForUpload(fileData);
    }

    // 2. Guardar metadata en la base de datos
    const result = await pool.query(
      `INSERT INTO files (user_id, original_name, filename, mimetype, size, url, storage_type, waveform_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        user_id || null,
        fileData.originalName,
        fileData.filename,
        fileData.mimetype,
        fileData.size,
        fileData.url,
        fileData.storageType,
        waveformUrl
      ]
    );

    res.status(201).json({
      message: 'Archivo subido y registrado exitosamente',
      file: result.rows[0]
    });

  } catch (error) {
    console.error('Error subiendo archivo:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

/**
 * Endpoint para subir archivos musicales (musical_archives)
 */
app.post('/api/musical-archives', upload.fields([{ name: 'archive', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), async (req, res) => {
  try {
    const { user_id, archive_name, description, privacy, genre_id, tags } = req.body;

    if (!user_id) {
      return res.status(400).json({ message: 'user_id es obligatorio para subir un archivo musical' });
    }
    
    if (!req.files || !req.files.archive) {
      return res.status(400).json({ message: 'No se subió ningún archivo musical' });
    }

    const archiveFile = req.files.archive[0];
    const thumbnailFile = req.files.thumbnail ? req.files.thumbnail[0] : null;

    // Determinar archive_type
    let archive_type = 'AUDIO';
    if (archiveFile.mimetype.startsWith('video/')) {
      archive_type = 'VIDEO';
    }

    // Determinar format
    const format = path.extname(archiveFile.originalname).replace('.', '').toLowerCase() || 'unknown';

    // 1. Guardar archivos físicamente
    const archiveData = await storageService.uploadFile(archiveFile);
    let thumbnailData = null;
    if (thumbnailFile) {
      thumbnailData = await storageService.uploadFile(thumbnailFile);
    }
    let waveformUrl = null;
    if (archive_type === 'AUDIO' && archiveData.storageType === 'local') {
      waveformUrl = await audioWaveformService.generateForUpload(archiveData);
    }

    let parsedTags = [];
    if (tags) {
      try {
        const parsed = JSON.parse(tags);
        if (Array.isArray(parsed)) {
          parsedTags = parsed.filter((t) => typeof t === 'string' && t.trim() !== '');
        }
      } catch {
        parsedTags = [];
      }
    }

    await pool.query('BEGIN');

    const finalTitle = archive_name || archiveFile.originalname;
    // Normalizamos al formato que suele exigir el CHECK de la tabla projects.
    const finalVisibility = privacy === 'private' ? 'PRIVATE' : 'PUBLIC';
    const finalGenreId = genre_id ? Number(genre_id) : null;
    const finalUserId = Number(user_id);

    if (Number.isNaN(finalUserId)) {
      return res.status(400).json({ message: 'user_id no es valido' });
    }

    // 2. Crear proyecto con la metadata principal
    const projectResult = await pool.query(
      `INSERT INTO projects (user_id, title, description, visibility, genre_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING project_id`,
      [
        finalUserId,
        finalTitle,
        description || null,
        finalVisibility,
        finalGenreId
      ]
    );
    const createdProjectId = projectResult.rows[0].project_id;

    // 3. Relacionar tags con el proyecto
    for (const rawTag of parsedTags) {
      const normalizedTag = rawTag.trim().toLowerCase();
      if (!normalizedTag) continue;

      let tagId;
      const existingTag = await pool.query(
        'SELECT tag_id FROM tags WHERE LOWER(name) = LOWER($1) LIMIT 1',
        [normalizedTag]
      );

      if (existingTag.rows.length > 0) {
        tagId = existingTag.rows[0].tag_id;
      } else {
        const createdTag = await pool.query(
          'INSERT INTO tags (name) VALUES ($1) RETURNING tag_id',
          [normalizedTag]
        );
        tagId = createdTag.rows[0].tag_id;
      }

      await pool.query(
        `INSERT INTO project_tags (project_id, tag_id)
         SELECT $1, $2
         WHERE NOT EXISTS (
           SELECT 1 FROM project_tags WHERE project_id = $1 AND tag_id = $2
         )`,
        [createdProjectId, tagId]
      );
    }

    // 4. Guardar archivo musical enlazado al proyecto
    const result = await pool.query(
      `INSERT INTO musical_archives (user_id, project_id, archive_name, archive_type, format, url_archive, thumbnail_url, waveform_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        finalUserId,
        createdProjectId,
        finalTitle,
        archive_type,
        format,
        archiveData.url,
        thumbnailData ? thumbnailData.url : null,
        waveformUrl
      ]
    );

    await pool.query('COMMIT');

    res.status(201).json({
      message: 'Archivo musical subido exitosamente',
      musical_archive: result.rows[0]
    });

  } catch (error) {
    try {
      await pool.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error haciendo rollback:', rollbackError);
    }
    console.error('Error subiendo archivo musical:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

/**
 * Endpoint para obtener lista de archivos de un usuario
 */
app.get('/api/files/user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query('SELECT * FROM files WHERE user_id = $1 ORDER BY created_at DESC', [user_id]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo archivos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

/**
 * Endpoint para obtener proyectos de un usuario con su thumbnail
 */
app.get('/api/projects/user/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         p.project_id,
         p.title,
         p.description,
         p.visibility,
         ma.thumbnail_url,
         ma.waveform_url
       FROM projects p
       LEFT JOIN LATERAL (
         SELECT thumbnail_url, waveform_url
         FROM musical_archives
         WHERE project_id = p.project_id
         LIMIT 1
       ) ma ON TRUE
       WHERE p.user_id = $1
       ORDER BY p.project_id DESC`,
      [user_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo proyectos del usuario:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

/**
 * Endpoint para archivos recomendados (audio o video, orden aleatorio simple)
 */
app.get('/api/videos/recommended', async (req, res) => {
  const limit = Number(req.query.limit) || 20;
  const safeLimit = Math.max(1, Math.min(limit, 60));

  try {
    const result = await pool.query(
      `SELECT
         p.project_id,
         p.title,
         p.description,
         p.creation_date,
         u.username,
         ma.thumbnail_url,
         ma.archive_type
       FROM projects p
       JOIN users u ON u.user_id = p.user_id
       JOIN LATERAL (
         SELECT thumbnail_url, archive_type
         FROM musical_archives
         WHERE project_id = p.project_id
         LIMIT 1
       ) ma ON TRUE
       WHERE ma.archive_type IN ('AUDIO', 'VIDEO')
       ORDER BY RANDOM()
       LIMIT $1`,
      [safeLimit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo videos recomendados:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

/**
 * Endpoint para obtener info pública de un usuario
 */
/**
 * Endpoint para archivos recientes
 */
app.get('/api/videos/recent', async (req, res) => {
  const limit = Number(req.query.limit) || 12;
  const safeLimit = Math.max(1, Math.min(limit, 60));

  try {
    const result = await pool.query(
      `SELECT
         p.project_id,
         p.title,
         p.description,
         p.creation_date,
         u.username,
         ma.thumbnail_url,
         ma.archive_type
       FROM projects p
       JOIN users u ON u.user_id = p.user_id
       JOIN LATERAL (
         SELECT thumbnail_url, archive_type
         FROM musical_archives
         WHERE project_id = p.project_id
         LIMIT 1
       ) ma ON TRUE
       WHERE ma.archive_type IN ('AUDIO', 'VIDEO')
       ORDER BY p.creation_date DESC, p.project_id DESC
       LIMIT $1`,
      [safeLimit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo videos recientes:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

/**
 * Endpoint de búsqueda de proyectos por título o usuario
 */
app.get('/api/videos/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const limit = Number(req.query.limit) || 30;
  const safeLimit = Math.max(1, Math.min(limit, 100));

  if (!query) {
    return res.json([]);
  }

  try {
    const result = await pool.query(
      `SELECT
         p.project_id,
         p.title,
         p.description,
         p.creation_date,
         u.username,
         ma.thumbnail_url,
         ma.archive_type
       FROM projects p
       JOIN users u ON u.user_id = p.user_id
       JOIN LATERAL (
         SELECT thumbnail_url, archive_type
         FROM musical_archives
         WHERE project_id = p.project_id
         LIMIT 1
       ) ma ON TRUE
       WHERE ma.archive_type IN ('AUDIO', 'VIDEO')
         AND (
           p.title ILIKE $1
           OR u.username ILIKE $1
         )
       ORDER BY p.creation_date DESC, p.project_id DESC
       LIMIT $2`,
      [`%${query}%`, safeLimit]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error en búsqueda de videos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.get('/api/users/:user_id/public', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         u.user_id,
         u.username,
         u.profile_picture_url,
         u.cover_picture_url,
         COALESCE(followers.total_followers, 0) AS followers_count,
         COALESCE(following.total_following, 0) AS following_count
       FROM users
       u
       LEFT JOIN (
         SELECT following_id, COUNT(*)::INT AS total_followers
         FROM user_follows
         GROUP BY following_id
       ) followers ON followers.following_id = u.user_id
       LEFT JOIN (
         SELECT follower_id, COUNT(*)::INT AS total_following
         FROM user_follows
         GROUP BY follower_id
       ) following ON following.follower_id = u.user_id
       WHERE u.user_id = $1
       LIMIT 1`,
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error obteniendo usuario público:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

/**
 * Endpoint para seguir a un usuario
 */
app.post('/api/users/:user_id/follow', async (req, res) => {
  const targetUserId = Number(req.params.user_id);
  const followerId = Number(req.body.follower_id);

  if (!Number.isInteger(targetUserId) || !Number.isInteger(followerId)) {
    return res.status(400).json({ message: 'user_id y follower_id deben ser números válidos' });
  }

  if (targetUserId === followerId) {
    return res.status(400).json({ message: 'Un usuario no puede seguirse a sí mismo' });
  }

  try {
    const insertResult = await pool.query(
      `INSERT INTO user_follows (follower_id, following_id)
       VALUES ($1, $2)
       ON CONFLICT (follower_id, following_id) DO NOTHING
       RETURNING follower_id, following_id, created_at`,
      [followerId, targetUserId]
    );

    const alreadyFollowing = insertResult.rows.length === 0;
    return res.status(alreadyFollowing ? 200 : 201).json({
      message: alreadyFollowing ? 'Ya seguías a este usuario' : 'Ahora sigues a este usuario',
      is_following: true
    });
  } catch (error) {
    console.error('Error siguiendo usuario:', error);
    return res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

/**
 * Endpoint para dejar de seguir a un usuario
 */
app.delete('/api/users/:user_id/follow', async (req, res) => {
  const targetUserId = Number(req.params.user_id);
  const followerId = Number(req.body.follower_id);

  if (!Number.isInteger(targetUserId) || !Number.isInteger(followerId)) {
    return res.status(400).json({ message: 'user_id y follower_id deben ser números válidos' });
  }

  try {
    const deleteResult = await pool.query(
      `DELETE FROM user_follows
       WHERE follower_id = $1 AND following_id = $2
       RETURNING follower_id, following_id`,
      [followerId, targetUserId]
    );

    return res.status(200).json({
      message: deleteResult.rows.length ? 'Dejaste de seguir a este usuario' : 'No seguías a este usuario',
      is_following: false
    });
  } catch (error) {
    console.error('Error dejando de seguir usuario:', error);
    return res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

/**
 * Endpoint para listar seguidores de un usuario
 */
app.get('/api/users/:user_id/followers', async (req, res) => {
  const userId = Number(req.params.user_id);
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 30, 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  if (!Number.isInteger(userId)) {
    return res.status(400).json({ message: 'user_id debe ser un número válido' });
  }

  try {
    const result = await pool.query(
      `SELECT
         uf.created_at AS followed_at,
         u.user_id,
         u.username,
         u.profile_picture_url
       FROM user_follows uf
       JOIN users u ON u.user_id = uf.follower_id
       WHERE uf.following_id = $1
       ORDER BY uf.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error listando seguidores:', error);
    return res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

/**
 * Endpoint para listar usuarios seguidos por un usuario
 */
app.get('/api/users/:user_id/following', async (req, res) => {
  const userId = Number(req.params.user_id);
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 30, 100));
  const offset = Math.max(0, Number(req.query.offset) || 0);

  if (!Number.isInteger(userId)) {
    return res.status(400).json({ message: 'user_id debe ser un número válido' });
  }

  try {
    const result = await pool.query(
      `SELECT
         uf.created_at AS followed_at,
         u.user_id,
         u.username,
         u.profile_picture_url
       FROM user_follows uf
       JOIN users u ON u.user_id = uf.following_id
       WHERE uf.follower_id = $1
       ORDER BY uf.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error listando seguidos:', error);
    return res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

/**
 * Endpoint para conocer estado de seguimiento entre dos usuarios
 */
app.get('/api/users/:user_id/follow-status/:viewer_id', async (req, res) => {
  const targetUserId = Number(req.params.user_id);
  const viewerId = Number(req.params.viewer_id);

  if (!Number.isInteger(targetUserId) || !Number.isInteger(viewerId)) {
    return res.status(400).json({ message: 'user_id y viewer_id deben ser números válidos' });
  }

  if (targetUserId === viewerId) {
    return res.status(200).json({ is_following: false, is_self: true });
  }

  try {
    const result = await pool.query(
      `SELECT 1
       FROM user_follows
       WHERE follower_id = $1 AND following_id = $2
       LIMIT 1`,
      [viewerId, targetUserId]
    );

    return res.status(200).json({ is_following: result.rows.length > 0, is_self: false });
  } catch (error) {
    console.error('Error consultando follow-status:', error);
    return res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

/**
 * Endpoint para obtener detalle de video por project_id
 */
app.get('/api/video-detail/:project_id', async (req, res) => {
  const { project_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         p.project_id,
         p.title,
         p.description,
         p.creation_date,
         p.user_id,
         u.username,
         u.profile_picture_url,
         ma.url_archive,
         ma.thumbnail_url,
         ma.archive_type,
         ma.waveform_url,
         COALESCE((
           SELECT json_agg(t.name ORDER BY t.name)
           FROM project_tags pt
           JOIN tags t ON t.tag_id = pt.tag_id
           WHERE pt.project_id = p.project_id
         ), '[]'::json) AS tags
       FROM projects p
       JOIN users u ON u.user_id = p.user_id
       JOIN LATERAL (
         SELECT url_archive, thumbnail_url, archive_type, waveform_url
         FROM musical_archives
         WHERE project_id = p.project_id
         LIMIT 1
       ) ma ON TRUE
       WHERE p.project_id = $1
       LIMIT 1`,
      [project_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Video no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error obteniendo detalle de video:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

/**
 * Endpoint para listar comentarios de un proyecto
 */
app.get('/api/projects/:project_id/comments', async (req, res) => {
  const { project_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         pc.comment_id,
         pc.project_id,
         pc.user_id,
         pc.content,
         pc.created_at,
         u.username,
         u.profile_picture_url
       FROM project_comments pc
       JOIN users u ON u.user_id = pc.user_id
       WHERE pc.project_id = $1
       ORDER BY pc.created_at DESC`,
      [project_id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo comentarios:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

/**
 * Endpoint para crear comentario en un proyecto
 */
app.post('/api/projects/:project_id/comments', async (req, res) => {
  const { project_id } = req.params;
  const { user_id, content } = req.body;

  if (!user_id) {
    return res.status(400).json({ message: 'user_id es obligatorio' });
  }

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ message: 'El comentario no puede estar vacio' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO project_comments (project_id, user_id, content)
       VALUES ($1, $2, $3)
       RETURNING comment_id, project_id, user_id, content, created_at`,
      [Number(project_id), Number(user_id), content.trim()]
    );

    res.status(201).json({
      message: 'Comentario publicado',
      comment: result.rows[0]
    });
  } catch (error) {
    console.error('Error creando comentario:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

/**
 * Endpoint para subir la foto de perfil de un usuario
 */
app.post('/api/users/:user_id/profile-picture', upload.single('profile_picture'), async (req, res) => {
  const { user_id } = req.params;

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se subió ninguna imagen' });
    }

    // Validar tipo de archivo (solo imágenes)
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'El archivo debe ser una imagen válida' });
    }

    // 1. Guardar archivo físicamente
    const fileData = await storageService.uploadFile(req.file);

    // 2. Registrar en la tabla files (opcional, para llevar registro de todas las fotos subidas)
    await pool.query(
      `INSERT INTO files (user_id, original_name, filename, mimetype, size, url, storage_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user_id, fileData.originalName, fileData.filename, fileData.mimetype, fileData.size, fileData.url, fileData.storageType]
    );

    // 3. Actualizar el perfil del usuario
    const updatedUser = await pool.query(
      `UPDATE users SET profile_picture_url = $1 WHERE user_id = $2 RETURNING profile_picture_url`,
      [fileData.url, user_id]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.status(200).json({
      message: 'Foto de perfil actualizada exitosamente',
      profile_picture_url: updatedUser.rows[0].profile_picture_url
    });

  } catch (error) {
    console.error('Error subiendo foto de perfil:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

/**
 * Endpoint para subir la foto de portada (banner) de un usuario
 */
app.post('/api/users/:user_id/cover-picture', upload.single('cover_picture'), async (req, res) => {
  const { user_id } = req.params;

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No se subió ninguna imagen' });
    }

    // Validar tipo de archivo (solo imágenes)
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ message: 'El archivo debe ser una imagen válida' });
    }

    // 1. Guardar archivo físicamente
    const fileData = await storageService.uploadFile(req.file);

    // 2. Registrar en la tabla files (opcional)
    await pool.query(
      `INSERT INTO files (user_id, original_name, filename, mimetype, size, url, storage_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [user_id, fileData.originalName, fileData.filename, fileData.mimetype, fileData.size, fileData.url, fileData.storageType]
    );

    // 3. Actualizar el perfil del usuario
    const updatedUser = await pool.query(
      `UPDATE users SET cover_picture_url = $1 WHERE user_id = $2 RETURNING cover_picture_url`,
      [fileData.url, user_id]
    );

    if (updatedUser.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }

    res.status(200).json({
      message: 'Foto de portada actualizada exitosamente',
      cover_picture_url: updatedUser.rows[0].cover_picture_url
    });

  } catch (error) {
    console.error('Error subiendo foto de portada:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

// Endpoint para obtener todos los géneros
app.get('/api/genres', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM genres ORDER BY name ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Error obteniendo géneros:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// --- CHAT ENDPOINTS ---
app.post('/api/chat/conversations', async (req, res) => {
  const { user_one_id, user_two_id } = req.body;

  if (!user_one_id || !user_two_id) {
    return res.status(400).json({ message: 'user_one_id y user_two_id son obligatorios' });
  }

  if (Number(user_one_id) === Number(user_two_id)) {
    return res.status(400).json({ message: 'No se puede crear un chat con el mismo usuario' });
  }

  try {
    const existing = await pool.query(
      `SELECT cp1.conversation_id
       FROM chat_participants cp1
       JOIN chat_participants cp2 ON cp1.conversation_id = cp2.conversation_id
       WHERE cp1.user_id = $1 AND cp2.user_id = $2
       LIMIT 1`,
      [Number(user_one_id), Number(user_two_id)]
    );

    if (existing.rows.length > 0) {
      return res.status(200).json({ conversation_id: existing.rows[0].conversation_id });
    }

    await pool.query('BEGIN');
    const createdConv = await pool.query(
      `INSERT INTO chat_conversations DEFAULT VALUES RETURNING conversation_id`
    );

    const conversationId = createdConv.rows[0].conversation_id;

    await pool.query(
      `INSERT INTO chat_participants (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
      [conversationId, Number(user_one_id), Number(user_two_id)]
    );

    await pool.query('COMMIT');
    return res.status(201).json({ conversation_id: conversationId });
  } catch (error) {
    try { await pool.query('ROLLBACK'); } catch {}
    console.error('Error creando conversación:', error);
    return res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

app.get('/api/chat/conversations/:user_id', async (req, res) => {
  const { user_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         c.conversation_id,
         u.user_id AS other_user_id,
         u.username AS other_username,
         u.profile_picture_url AS other_profile_picture_url,
         m.content AS last_message,
         m.created_at AS last_message_at
       FROM chat_conversations c
       JOIN chat_participants cp_me
         ON cp_me.conversation_id = c.conversation_id AND cp_me.user_id = $1
       JOIN chat_participants cp_other
         ON cp_other.conversation_id = c.conversation_id AND cp_other.user_id <> $1
       JOIN users u ON u.user_id = cp_other.user_id
       LEFT JOIN LATERAL (
         SELECT content, created_at
         FROM chat_messages
         WHERE conversation_id = c.conversation_id
         ORDER BY created_at DESC
         LIMIT 1
       ) m ON TRUE
       ORDER BY m.created_at DESC NULLS LAST, c.conversation_id DESC`,
      [Number(user_id)]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error listando conversaciones:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.get('/api/chat/messages/:conversation_id', async (req, res) => {
  const { conversation_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT
         cm.message_id,
         cm.conversation_id,
         cm.sender_id,
         cm.content,
         cm.created_at,
         u.username,
         u.profile_picture_url
       FROM chat_messages cm
       JOIN users u ON u.user_id = cm.sender_id
       WHERE cm.conversation_id = $1
       ORDER BY cm.created_at ASC`,
      [Number(conversation_id)]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error listando mensajes:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

app.post('/api/chat/messages', async (req, res) => {
  const { conversation_id, sender_id, content } = req.body;

  if (!conversation_id || !sender_id || !content || !String(content).trim()) {
    return res.status(400).json({ message: 'conversation_id, sender_id y content son obligatorios' });
  }

  try {
    const created = await pool.query(
      `INSERT INTO chat_messages (conversation_id, sender_id, content)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [Number(conversation_id), Number(sender_id), String(content).trim()]
    );

    await pool.query(
      `UPDATE chat_conversations SET updated_at = NOW() WHERE conversation_id = $1`,
      [Number(conversation_id)]
    );

    const message = created.rows[0];
    io.to(`conversation_${message.conversation_id}`).emit('new_message', message);
    res.status(201).json({ message: 'Mensaje enviado', data: message });
  } catch (error) {
    console.error('Error enviando mensaje:', error);
    res.status(500).json({ message: 'Error interno del servidor', error: error.message });
  }
});

io.on('connection', (socket) => {
  socket.on('join_conversation', (conversationId) => {
    socket.join(`conversation_${conversationId}`);
  });

  socket.on('leave_conversation', (conversationId) => {
    socket.leave(`conversation_${conversationId}`);
  });

  socket.on('send_message', async (payload) => {
    const { conversation_id, sender_id, content } = payload || {};
    if (!conversation_id || !sender_id || !content || !String(content).trim()) return;

    try {
      const created = await pool.query(
        `INSERT INTO chat_messages (conversation_id, sender_id, content)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [Number(conversation_id), Number(sender_id), String(content).trim()]
      );

      await pool.query(
        `UPDATE chat_conversations SET updated_at = NOW() WHERE conversation_id = $1`,
        [Number(conversation_id)]
      );

      io.to(`conversation_${conversation_id}`).emit('new_message', created.rows[0]);
    } catch (error) {
      console.error('Error socket send_message:', error);
    }
  });
});

// Ruta básica de prueba
app.get('/', (req, res) => {
  res.send('Servidor de Harawi funcionando');
});

httpServer.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
