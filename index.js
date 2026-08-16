const functions = require("firebase-functions");
const admin = require("firebase-admin");
const Razorpay = require("razorpay");
const crypto = require("crypto");
const cors = require("cors")({ origin: true });

admin.initializeApp();
const db = admin.firestore();

const RAZORPAY_KEY_ID = "rzp_test_TPGmu6azWnSXNj";
const RAZORPAY_KEY_SECRET = "u4uIt6jN8MYnqlUV2V9uo2HA";
const PREMIUM_PRICE_INR = 1000;

const razorpayInstance = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET,
});

exports.createRazorpayOrder = functions.https.onCall(async (data, context) => {
    // Ensure user is authenticated
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "You must be logged in to make a purchase."
        );
    }

    const options = {
        amount: PREMIUM_PRICE_INR * 100, // amount in the smallest currency unit (paise)
        currency: "INR",
        receipt: `receipt_${context.auth.uid}_${Date.now()}`,
    };

    try {
        const order = await razorpayInstance.orders.create(options);
        return {
            id: order.id,
            currency: order.currency,
            amount: order.amount,
            keyId: RAZORPAY_KEY_ID // Needed by frontend
        };
    } catch (error) {
        console.error("Error creating Razorpay order:", error);
        throw new functions.https.HttpsError(
            "internal",
            "Failed to create Razorpay order."
        );
    }
});

exports.verifyRazorpayPayment = functions.https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError(
            "unauthenticated",
            "You must be logged in to verify a purchase."
        );
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = data;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "Missing payment verification data."
        );
    }

    // Verify signature
    const text = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
        .createHmac("sha256", RAZORPAY_KEY_SECRET)
        .update(text.toString())
        .digest("hex");

    if (expectedSignature === razorpay_signature) {
        // Payment is successful and verified
        // Update user's Firestore document
        try {
            await db.collection("users").doc(context.auth.uid).set(
                { isPremium: true },
                { merge: true }
            );

            return { success: true, message: "Payment verified successfully. Welcome to Premium!" };
        } catch (error) {
            console.error("Error updating user document:", error);
            throw new functions.https.HttpsError(
                "internal",
                "Payment verified, but failed to update user profile."
            );
        }
    } else {
        throw new functions.https.HttpsError(
            "invalid-argument",
            "Invalid payment signature."
        );
    }
});
