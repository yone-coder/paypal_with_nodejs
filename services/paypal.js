const axios = require('axios');

async function generateAccessToken() {
    const response = await axios({
        url: `${process.env.PAYPAL_BASE_URL}/v1/oauth2/token`,
        method: 'post',
        data: 'grant_type=client_credentials',
        auth: {
            username: process.env.PAYPAL_CLIENT_ID,
            password: process.env.PAYPAL_SECRET
        }
    });

    return response.data.access_token;
}

async function createOrder({ amount, currency = 'USD', items = [], description = '', returnUrl, cancelUrl }) {
    const accessToken = await generateAccessToken();

    const itemTotal = items.reduce((sum, item) => sum + parseFloat(item.unit_amount.value) * item.quantity, 0).toFixed(2);

    const response = await axios({
        url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders`,
        method: 'post',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        data: {
            intent: 'CAPTURE',
            purchase_units: [
                {
                    description,
                    items,
                    amount: {
                        currency_code: currency,
                        value: itemTotal,
                        breakdown: {
                            item_total: {
                                currency_code: currency,
                                value: itemTotal
                            }
                        }
                    }
                }
            ],
            application_context: {
                return_url: returnUrl || `${process.env.BASE_URL}/complete-order`,
                cancel_url: cancelUrl || `${process.env.BASE_URL}/cancel-order`,
                shipping_preference: 'NO_SHIPPING',
                user_action: 'PAY_NOW',
                brand_name: 'YourBrandName'
            }
        }
    });

    const approveLink = response.data.links.find(link => link.rel === 'approve');
    return approveLink.href;
}

async function capturePayment(orderId) {
    const accessToken = await generateAccessToken();

    const response = await axios({
        url: `${process.env.PAYPAL_BASE_URL}/v2/checkout/orders/${orderId}/capture`,
        method: 'post',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        }
    });

    return response.data;
}

module.exports = {
    generateAccessToken,
    createOrder,
    capturePayment
};