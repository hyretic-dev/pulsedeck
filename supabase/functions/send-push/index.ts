import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'https://esm.sh/web-push@3.6.7'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// VAPID Keys (Better as secrets: SUPABASE_VAPID_PUBLIC_KEY, SUPABASE_VAPID_PRIVATE_KEY)
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY') || 'BO19JVr7-jl1y39KHtprGelr3EtWnZAJRHexWD4N_TBBZkw9GAPIBmuIgjhq3trSl1H8qS2NOAWLCjNZNv8L4xs'
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY') || 'gjBft6ew5cZoKQ0SGqFIIXer0fY4phr47yZ_67bdhiA'

webpush.setVapidDetails(
  'mailto:info@pulsedeck.de',
  vapidPublicKey,
  vapidPrivateKey
)

const supabase = createClient(supabaseUrl, supabaseServiceKey)

Deno.serve(async (req) => {
  try {
    const { record } = await req.json()
    const { payload, organization_id, id: queue_id } = record

    console.log(`Processing push for org ${organization_id}:`, payload.title)

    // 1. Get all members of the organization
    const { data: members, error: memberError } = await supabase
      .from('members')
      .select('id')
      .eq('organization_id', organization_id)

    if (memberError) throw memberError
    const memberIds = members.map(m => m.id)

    // 2. Get active push subscriptions for these members
    const { data: subscriptions, error: subError } = await supabase
      .from('push_subscriptions')
      .select('*')
      .in('member_id', memberIds)

    if (subError) throw subError

    console.log(`Found ${subscriptions.length} subscriptions to notify.`)

    // 3. Send notifications in parallel
    const notifications = subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          JSON.stringify({
            title: payload.title,
            body: payload.message,
            icon: '/assets/icons/icon-192x192.png',
            data: {
              url: payload.table === 'events' ? `/dashboard/calendar` : `/dashboard/feed`
            }
          })
        )
      } catch (err: any) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          // Subscription expired or invalid - delete it
          console.log(`Deleting invalid subscription: ${sub.id}`)
          await supabase.from('push_subscriptions').delete().eq('id', sub.id)
        } else {
          console.error(`Error sending push to ${sub.id}:`, err)
        }
      }
    })

    await Promise.all(notifications)

    // 4. Mark queue item as processed
    await supabase
      .from('push_notification_queue')
      .update({ processed: true })
      .eq('id', queue_id)

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    console.error('Push Function Error:', err.message)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
