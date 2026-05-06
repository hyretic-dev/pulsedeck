// supabase/functions/send-event-notification/index.ts
// Edge Function: Process push_notification_queue
// and send email notifications for new events.
//
// Deployment: supabase functions deploy send-event-notification
// Schedule: Set up via Supabase Dashboard > Edge Functions > Cron

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import {
  createClient,
} from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRoleKey =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

serve(async (_req: Request) => {
  const supabase = createClient(
    supabaseUrl,
    serviceRoleKey
  );

  // 1. Fetch unprocessed notifications
  const { data: queue, error: fetchError } =
    await supabase
      .from('push_notification_queue')
      .select('*')
      .eq('processed', false)
      .order('created_at', { ascending: true })
      .limit(50);

  if (fetchError) {
    return new Response(
      JSON.stringify({ error: fetchError.message }),
      { status: 500 }
    );
  }

  if (!queue || queue.length === 0) {
    return new Response(
      JSON.stringify({ message: 'No pending notifications' }),
      { status: 200 }
    );
  }

  const processed: string[] = [];

  for (const item of queue) {
    const payload = item.payload;

    // Only handle event notifications for now
    if (payload.table !== 'events') {
      processed.push(item.id);
      continue;
    }

    // 2. Get AG members for the event's org
    const { data: members } = await supabase
      .from('members')
      .select('email, name')
      .eq('organization_id', item.organization_id)
      .not('email', 'is', null);

    if (!members || members.length === 0) {
      processed.push(item.id);
      continue;
    }

    // 3. Send email via configured SMTP
    // TODO: Replace with actual SMTP/Resend/Mailgun
    // integration once SMTP provider is configured.
    //
    // For now, log the notification:
    console.log(
      `[Event Notification] ${payload.title}`,
      `Recipients: ${members.length}`,
      `Message: ${payload.message}`
    );

    // Example with Resend (uncomment when ready):
    // const resendKey = Deno.env.get('RESEND_API_KEY');
    // for (const member of members) {
    //   await fetch('https://api.resend.com/emails', {
    //     method: 'POST',
    //     headers: {
    //       'Authorization': `Bearer ${resendKey}`,
    //       'Content-Type': 'application/json',
    //     },
    //     body: JSON.stringify({
    //       from: 'PulseDeck <noreply@pulsedeck.de>',
    //       to: member.email,
    //       subject: `Neuer Termin: ${payload.title}`,
    //       html: `<p>Hallo ${member.name},</p>
    //              <p>${payload.message}</p>
    //              <p>Schau in PulseDeck vorbei!</p>`,
    //     }),
    //   });
    // }

    processed.push(item.id);
  }

  // 4. Mark as processed
  if (processed.length > 0) {
    await supabase
      .from('push_notification_queue')
      .update({ processed: true })
      .in('id', processed);
  }

  return new Response(
    JSON.stringify({
      message: `Processed ${processed.length} notifications`,
    }),
    { status: 200 }
  );
});
