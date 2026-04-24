// Invoke with: supabase functions invoke send-newsletter
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createTransport } from "npm:nodemailer@6.9.13";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Generate simple, accessible newsletter HTML
 * Minimal styling, works in all email clients
 */
function generateNewsletterHtml(
  items: any[],
  config: { logo_url?: string; footer_text?: string; primary_color?: string }
): string {
  const color = config.primary_color || '#DE0000';
  const footer = config.footer_text || 'PulseDeck - Vereinsverwaltung';
  const siteUrl = Deno.env.get('SITE_URL') || 'https://pulsedeck.de';

  // Simple link list - accessible and lightweight
  const itemsHtml = items.map((item: any) => {
    const date = new Date(item.created_at).toLocaleDateString('de-DE');
    const author = item.author?.name || 'Unbekannt';
    const itemUrl = item.url || `${siteUrl}/dashboard/feed`;

    return `
<tr>
  <td style="padding: 12px 0; border-bottom: 1px solid #eee;">
    <a href="${itemUrl}" style="color: ${color}; text-decoration: none; font-weight: 600; font-size: 16px;">${item.title}</a>
    <br>
    <small style="color: #666;">${date} – ${author}</small>
    ${item.content ? `<p style="margin: 8px 0 0; color: #333; line-height: 1.5;">${stripHtml(item.content).slice(0, 150)}...</p>` : ''}
  </td>
</tr>`;
  }).join('');

  // Logo: Image if URL provided, otherwise text
  const logoHtml = config.logo_url
    ? `<img src="${config.logo_url}" alt="Logo" style="max-height: 40px; max-width: 150px;">`
    : `<span style="font-size: 24px; font-weight: bold; color: ${color};">PulseDeck</span>`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width">
  <title>PulseDeck Newsletter</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: #f5f5f5; padding: 20px 0;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background: #fff; border-radius: 4px;">
          
          <!-- Header -->
          <tr>
            <td style="padding: 24px; border-bottom: 2px solid ${color};">
              ${logoHtml}
            </td>
          </tr>
          
          <!-- Intro -->
          <tr>
            <td style="padding: 24px 24px 8px;">
              <h1 style="margin: 0; font-size: 20px; color: #333;">Neue Beiträge</h1>
              <p style="margin: 8px 0 0; color: #666; font-size: 14px;">
                Hier sind die neuesten Artikel und Links für dich:
              </p>
            </td>
          </tr>
          
          <!-- Links List -->
          <tr>
            <td style="padding: 0 24px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                ${itemsHtml}
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 24px; text-align: center; border-top: 1px solid #eee; margin-top: 16px;">
              <small style="color: #999; font-size: 12px;">
                ${footer}
              </small>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Strip HTML tags for plain text preview */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        global: {
          headers: { Authorization: req.headers.get('Authorization')! },
        },
      }
    );

    const body = await req.json().catch(() => ({}));
    const { test_email, force } = body;

    // 1. Get Newsletter Configuration
    const { data: config, error: configError } = await supabaseClient
      .from('newsletter_config')
      .select('*')
      .single();

    if (configError) throw new Error('Could not load newsletter config: ' + configError.message);

    // 2. Check if active
    if (!test_email && !force && !config.active) {
      return new Response(JSON.stringify({ message: 'Newsletter is inactive.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 3. Get 'Approved' Items
    const { data: items, error: itemsError } = await supabaseClient
      .from('feed_items')
      .select('*, author:members(name)')
      .eq('status', 'approved')
      .order('created_at', { ascending: false });

    if (itemsError) throw itemsError;

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ message: 'No new articles to send.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 4. Generate Email HTML
    const emailHtml = generateNewsletterHtml(items, config);

    // 5. Send Email via SMTP
    if (config.smtp_host) {
      console.log(`SMTP: ${config.smtp_host}`);
      const transporter = createTransport({
        host: config.smtp_host,
        port: config.smtp_port || 587,
        secure: config.smtp_secure || false,
        auth: {
          user: config.smtp_user,
          pass: config.smtp_pass,
        },
      });

      const subject = test_email
        ? `[Vorschau] Newsletter (${items.length} Beiträge)`
        : `Neue Beiträge für dich`;

      if (test_email) {
        await transporter.sendMail({
          from: config.smtp_from || '"PulseDeck" <newsletter@pulsedeck.de>',
          to: test_email,
          subject,
          html: emailHtml
        });
        return new Response(JSON.stringify({
          success: true,
          message: `Test-E-Mail gesendet an ${test_email}`,
          test_mode: true
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      } else {
        // Real send: Loop through members
        const { data: members } = await supabaseClient.from('members').select('email');
        let sentCount = 0;
        if (members) {
          for (const m of members) {
            if (m.email) {
              try {
                await transporter.sendMail({
                  from: config.smtp_from || '"PulseDeck" <newsletter@pulsedeck.de>',
                  to: m.email,
                  subject,
                  html: emailHtml
                });
                sentCount++;
              } catch (e) {
                console.error(`Failed: ${m.email}`, e);
              }
            }
          }
        }
        console.log(`Sent to ${sentCount} members.`);
      }
    } else {
      console.log("No SMTP configured.");
      if (test_email) {
        return new Response(JSON.stringify({
          success: true,
          message: `Simuliert (kein SMTP). Würde an ${test_email} senden.`,
          test_mode: true
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // 6. Update status
    const itemIds = items.map((i: any) => i.id);
    await supabaseClient.from('feed_items').update({
      status: 'sent',
      sent_at: new Date().toISOString()
    }).in('id', itemIds);

    await supabaseClient.from('newsletter_config').update({
      last_sent_at: new Date().toISOString()
    }).eq('id', 1);

    return new Response(JSON.stringify({
      success: true,
      message: `Newsletter gesendet.`,
      count: items.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
