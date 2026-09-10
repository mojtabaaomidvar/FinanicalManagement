package ir.khaneyar.app;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.provider.Telephony;
import android.telephony.SmsMessage;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * پلاگینِ خواندنِ نیتیوِ پیامکِ بانکی (فقط اندروید).
 *
 * <p>هدف: وقتی بانک پیامکِ تراکنش می‌فرستد، اپ همان لحظه متن را می‌خواند و از طریق
 * لایهٔ JS به سرور می‌فرستد تا تراکنشِ «در انتظار» ساخته شود — بدونِ کپی/پیستِ دستی.
 * پارسِ متن و تصمیم «بانکی هست یا نه» سمتِ سرور انجام می‌شود؛ اینجا فقط متنِ خام و
 * فرستنده را بالا می‌دهیم.
 *
 * <p>محدودهٔ نسخهٔ ۱: گیرنده در «زمانِ اجرا» ثبت می‌شود، پس تا وقتی پروسهٔ اپ زنده است
 * (پیش‌زمینه یا گرم در حافظه) پیامک را می‌گیرد. برای دریافت در حالتِ کاملاً بسته باید
 * گیرنده را در Manifest اعلام کرد و بدونِ WebView مستقیم با سرور حرف زد؛ آن مسیر سطحِ
 * نیتیوِ بزرگ‌تری می‌خواهد و فعلاً «پلِ فورواردر» به‌عنوانِ جایگزین/وبِ فالبک می‌ماند.
 *
 * <p>مجوزها با نام‌مستعارِ «sms» اعلام شده‌اند؛ متدهای checkPermissions/requestPermissions
 * از خودِ Capacitor در دسترس‌اند و requestSmsPermission یک راهِ ساده با پاسخِ روشن است.
 */
@CapacitorPlugin(
    name = "SmsReader",
    permissions = {
        @Permission(
            alias = "sms",
            strings = { Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS }
        )
    }
)
public class SmsReaderPlugin extends Plugin {

    private BroadcastReceiver receiver;
    /** فیلترِ اختیاریِ فرستنده (زیررشته، حروفِ کوچک). خالی = همهٔ پیامک‌ها به پارسر برسند. */
    private final List<String> senderFilter = new ArrayList<>();

    /** آیا مجوزِ پیامک داده شده؟ (متدِ checkPermissionsِ داخلیِ Capacitor هم کار می‌کند.) */
    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            call.resolve(stateResult());
        } else {
            requestPermissionForAlias("sms", call, "smsPermsCallback");
        }
    }

    @PermissionCallback
    private void smsPermsCallback(PluginCall call) {
        call.resolve(stateResult());
    }

    /** شروعِ گوش‌دادن به پیامک‌های ورودی. آرایهٔ اختیاریِ senderFilter برای محدودکردن به بانک‌ها. */
    @PluginMethod
    public void startWatching(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) {
            call.reject("PERMISSION_DENIED");
            return;
        }

        senderFilter.clear();
        JSArray arr = call.getArray("senderFilter");
        if (arr != null) {
            for (int i = 0; i < arr.length(); i++) {
                String s = arr.optString(i, "").trim().toLowerCase(Locale.ROOT);
                if (!s.isEmpty()) senderFilter.add(s);
            }
        }

        registerReceiverIfNeeded();
        call.resolve();
    }

    /** توقفِ گوش‌دادن. */
    @PluginMethod
    public void stopWatching(PluginCall call) {
        unregister();
        call.resolve();
    }

    private void registerReceiverIfNeeded() {
        if (receiver != null) return;
        receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;

                SmsMessage[] msgs = Telephony.Sms.Intents.getMessagesFromIntent(intent);
                if (msgs == null || msgs.length == 0) return;

                // پیامکِ چندبخشی: بخش‌ها را به‌ترتیب به‌هم می‌چسبانیم؛ فرستنده از اولین بخش.
                StringBuilder body = new StringBuilder();
                String sender = null;
                for (SmsMessage m : msgs) {
                    if (m == null) continue;
                    if (sender == null) sender = m.getOriginatingAddress();
                    String part = m.getMessageBody();
                    if (part != null) body.append(part);
                }

                String text = body.toString().trim();
                if (text.isEmpty()) return;
                if (!senderAllowed(sender)) return;

                JSObject data = new JSObject();
                data.put("rawText", text);
                data.put("sender", sender);
                notifyListeners("smsReceived", data);
            }
        };

        IntentFilter filter = new IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION);
        // SMS_RECEIVED یک broadcastِ «محافظت‌شدهٔ سیستمی» است — فقط سیستم می‌تواند بفرستد،
        // پس EXPORTED امن است و روی اندروید ۱۳+ برای دریافتِ broadcastِ سیستمی لازم است.
        // (ContextCompat خودش فقط روی API 33+ فلگ را اعمال می‌کند.)
        ContextCompat.registerReceiver(
            getContext(), receiver, filter, ContextCompat.RECEIVER_EXPORTED
        );
    }

    private boolean senderAllowed(String sender) {
        if (senderFilter.isEmpty()) return true;
        if (sender == null) return false;
        String s = sender.toLowerCase(Locale.ROOT);
        for (String f : senderFilter) {
            if (s.contains(f)) return true;
        }
        return false;
    }

    private void unregister() {
        if (receiver != null) {
            try {
                getContext().unregisterReceiver(receiver);
            } catch (IllegalArgumentException ignored) {
                // قبلاً لغو شده — بی‌ضرر
            }
            receiver = null;
        }
    }

    private JSObject stateResult() {
        JSObject ret = new JSObject();
        ret.put("sms", getPermissionState("sms") == PermissionState.GRANTED ? "granted" : "denied");
        return ret;
    }

    @Override
    protected void handleOnDestroy() {
        unregister();
        super.handleOnDestroy();
    }
}
