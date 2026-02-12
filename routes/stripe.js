const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Webhook secret for Forms product
const WEBHOOK_SECRET = 'whsec_jQE7efAj2iy6S6oGamZzgyKnILBKmDty';

// Price IDs - should be set in environment variables
const PRICE_ID = process.env.STRIPE_PRICE_ID || 'price_forms_monthly'; // $2/month

// Create checkout session
router.post('/create-checkout-session', async (req, res) => {
  try {
    const { customerEmail, successUrl, cancelUrl } = req.body;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Forms - Form Backend Service',
              description: 'Form Backend-as-a-Service - $2/month'
            },
            unit_amount: 200, // $2.00 in cents
            recurring: {
              interval: 'month'
            }
          },
          quantity: 1
        }
      ],
      mode: 'subscription',
      success_url: successUrl || `${req.protocol}://${req.get('host')}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${req.protocol}://${req.get('host')}/cancel`,
      customer_email: customerEmail
    });

    res.json({ success: true, sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stripe webhook handler
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      console.log('✅ Checkout completed:', session.id);
      console.log('Customer:', session.customer_email);
      // TODO: Activate subscription in database
      break;
    }

    case 'invoice.paid': {
      const invoice = event.data.object;
      console.log('✅ Invoice paid:', invoice.id);
      console.log('Customer:', invoice.customer_email);
      // TODO: Update subscription status to active
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log('❌ Invoice payment failed:', invoice.id);
      console.log('Customer:', invoice.customer_email);
      // TODO: Mark subscription as past due, notify customer
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      console.log('🗑️ Subscription deleted:', subscription.id);
      console.log('Customer:', subscription.customer);
      // TODO: Deactivate subscription in database
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      console.log('📝 Subscription updated:', subscription.id);
      console.log('Status:', subscription.status);
      // TODO: Update subscription status in database
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

module.exports = router;
