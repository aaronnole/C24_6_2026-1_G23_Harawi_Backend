import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

dotenv.config();

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Verificar la conexión al inicio
transporter.verify((error, success) => {
  if (error) {
    console.error('Error configurando el servicio de correos:', error);
  } else {
    console.log('Servidor de correos listo para enviar mensajes');
  }
});

export default transporter;
