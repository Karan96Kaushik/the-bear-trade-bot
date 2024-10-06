const otplib = require('otplib');

const secret = process.env.KITE_TOTP_KEY;

const token = otplib.authenticator.generate(secret);

console.log('Your TOTP code is:', token);