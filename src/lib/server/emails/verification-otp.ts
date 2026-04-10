type OTPEmailType = 'email-verification' | 'sign-in' | 'forget-password';

type VerificationOTPEmailParams = {
	email: string;
	otp: string;
	type: OTPEmailType;
	expiresInMinutes: number;
};

type VerificationOTPEmail = {
	subject: string;
	html: string;
	text: string;
};

const BRAND_NAME = 'Ref@mncuchiinhuttt';

const escapeHtml = (value: string): string =>
	value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');

const getEmailCopy = (type: OTPEmailType): { heading: string; message: string; subject: string } => {
	switch (type) {
		case 'sign-in':
			return {
				heading: 'Sign in to your Ref account',
				message: 'Use this one-time code to continue your sign in.',
				subject: 'Your Ref sign-in verification code'
			};
		case 'forget-password':
			return {
				heading: 'Reset your Ref password',
				message: 'Use this one-time code to reset your password safely.',
				subject: 'Your Ref password reset code'
			};
		case 'email-verification':
		default:
			return {
				heading: 'Welcome to Ref',
				message: 'Verify your email address with this one-time code to finish creating your account.',
				subject: 'Welcome to Ref - verify your email'
			};
	}
};

const splitOTP = (otp: string): string[] => otp.split('').slice(0, 5);

export const buildVerificationOTPEmail = ({
	email,
	otp,
	type,
	expiresInMinutes
}: VerificationOTPEmailParams): VerificationOTPEmail => {
	const safeEmail = escapeHtml(email);
	const safeOtp = escapeHtml(otp);
	const safeExpires = escapeHtml(String(expiresInMinutes));
	const copy = getEmailCopy(type);
	const otpSlots = splitOTP(safeOtp)
		.map(
			(digit) =>
				`<span style="display:inline-block;height:52px;width:44px;line-height:52px;text-align:center;vertical-align:middle;border-radius:12px;border:1px solid #d7dee8;background:#ffffff;font-size:24px;font-weight:700;color:#111827;letter-spacing:0.02em;margin:0 4px">${digit}</span>`
		)
		.join('');

	const html = `
<!doctype html>
<html lang="en">
	<body style="margin:0;padding:0;background-color:#f6f8fb;color:#111827;font-family:Inter,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
		<table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="width:100%;border-collapse:collapse;background-color:#f6f8fb;">
			<tr>
				<td align="center" style="padding:28px 14px;background:radial-gradient(circle at 10% 0%,rgba(245,158,11,0.24),transparent 35%),radial-gradient(circle at 90% 100%,rgba(14,165,233,0.2),transparent 40%),#f6f8fb;">
			<table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" width="640" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e5eaf1;border-radius:20px;overflow:hidden;box-shadow:0 18px 46px rgba(15,23,42,0.08)">
        <tr>
          <td style="padding:26px 28px;background:linear-gradient(135deg,#fff7ed 0%,#eff6ff 100%);border-bottom:1px solid #e5eaf1;">
            <p style="margin:0;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#4b5563">No Reply - ${BRAND_NAME}</p>
            <h1 style="margin:10px 0 0;font-size:28px;line-height:1.2;letter-spacing:-0.01em;color:#111827">${escapeHtml(copy.heading)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:28px">
            <p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#334155">${escapeHtml(copy.message)}</p>
            <p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:#64748b">Email: ${safeEmail}</p>
            <p style="margin:0 0 18px;font-size:13px;line-height:1.6;color:#64748b">This code expires in ${safeExpires} minutes.</p>

						<div style="text-align:center;font-size:0;line-height:0;padding:16px 0 20px;">
              ${otpSlots}
            </div>

            <p style="margin:0;font-size:12px;line-height:1.7;color:#64748b">If you did not request this, you can safely ignore this email.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px;border-top:1px solid #e5eaf1;background:#f8fafc">
            <p style="margin:0;font-size:12px;line-height:1.6;color:#64748b">${BRAND_NAME}</p>
          </td>
        </tr>
      </table>
				</td>
			</tr>
		</table>
  </body>
</html>`.trim();

	const text = [
		copy.heading,
		'',
		copy.message,
		`Verification code: ${otp}`,
		`Email: ${email}`,
		`Expires in: ${expiresInMinutes} minutes`,
		'',
		'If you did not request this, you can ignore this email.'
	].join('\n');

	return {
		subject: copy.subject,
		html,
		text
	};
};
