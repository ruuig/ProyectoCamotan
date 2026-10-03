const { authenticator } = require('otplib');
const QRCode = require('qrcode');

const EMISOR = 'Centro de Salud de Camotan';

// Tolerancia de un paso (30 s) antes y despues, para relojes desfasados.
authenticator.options = { window: 1 };

function generarSecreto() {
  return authenticator.generateSecret();
}

function uriDeAlta(usuario, secreto) {
  return authenticator.keyuri(usuario, EMISOR, secreto);
}

async function codigoQr(usuario, secreto) {
  return QRCode.toDataURL(uriDeAlta(usuario, secreto));
}

function verificarCodigo(codigo, secreto) {
  if (!codigo || !secreto) return false;
  try {
    return authenticator.verify({ token: String(codigo).trim(), secret: secreto });
  } catch {
    // Un token mal formado no debe tumbar la peticion.
    return false;
  }
}

module.exports = { EMISOR, generarSecreto, uriDeAlta, codigoQr, verificarCodigo };
