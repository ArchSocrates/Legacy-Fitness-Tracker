package com.legacy.fitness;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Ongoing rest-timer notification with lock-screen buttons. */
@CapacitorPlugin(name = "WorkoutNotif")
public class WorkoutNotifPlugin extends Plugin {
    static final String CH = "legacy_rest";
    static final int ID = 4101;
    static final String PREFS = "legacy_notif";
    static WorkoutNotifPlugin inst;
    static long curEnd = 0;
    static String curLabel = "Rest", curNext = "";

    @Override
    public void load() {
        inst = this;
        makeChannel(getContext());
        drain();
        handleIntent(getActivity() != null ? getActivity().getIntent() : null);
    }

    @Override
    protected void handleOnResume() {
        inst = this;
        drain();
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        handleIntent(intent);
    }

    private void handleIntent(Intent i) {
        if (i == null) return;
        String a = i.getStringExtra("legacy_action");
        if (a != null) {
            i.removeExtra("legacy_action");
            cancel(getContext());
            emit(a);
        }
    }

    static void makeChannel(Context c) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CH, "Rest timer", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shows your rest countdown on the lock screen");
            ch.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
            ch.setSound(null, null);
            ch.enableVibration(false);
            ((NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
    }

    private static PendingIntent bc(Context c, String a, int code) {
        Intent i = new Intent(c, RestActionReceiver.class);
        i.putExtra("a", a);
        return PendingIntent.getBroadcast(c, code, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    static void post(Context c, long end, String label, String next) {
        curEnd = end;
        curLabel = label;
        curNext = next;
        long left = end - System.currentTimeMillis();
        if (left <= 0) {
            cancel(c);
            return;
        }
        Intent open = new Intent(c, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(c, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Intent nx = new Intent(c, MainActivity.class);
        nx.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        nx.putExtra("legacy_action", "next");
        PendingIntent nextPi = PendingIntent.getActivity(c, 2, nx, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CH)
            .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
            .setContentTitle("Rest")
            .setContentText(next != null && next.length() > 0 ? "Next: " + next : label)
            .setWhen(end)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openPi)
            .setTimeoutAfter(left + 2000)
            .addAction(0, "+30s", bc(c, "plus30", 10))
            .addAction(0, "Skip", bc(c, "skip", 11))
            .addAction(0, "Next set", nextPi);
        try {
            NotificationManagerCompat.from(c).notify(ID, b.build());
        } catch (SecurityException e) {
            /* notification permission not granted */
        }
    }

    static void cancel(Context c) {
        curEnd = 0;
        NotificationManagerCompat.from(c).cancel(ID);
    }

    @PluginMethod
    public void show(PluginCall call) {
        long end = call.getData().optLong("end", 0);
        post(getContext(), end, call.getString("label", "Rest"), call.getString("next", ""));
        call.resolve();
    }

    @PluginMethod
    public void hide(PluginCall call) {
        cancel(getContext());
        call.resolve();
    }

    void emit(String a) {
        JSObject o = new JSObject();
        o.put("a", a);
        notifyListeners("action", o, true);
    }

    /** Called by the receiver. Works whether or not the web page is alive. */
    static void deliver(Context c, String a) {
        if ("plus30".equals(a) && curEnd > 0) post(c, curEnd + 30000, curLabel, curNext);
        if ("skip".equals(a)) cancel(c);
        if (inst != null) {
            inst.emit(a);
        } else {
            SharedPreferences p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            p.edit().putString("pending", (p.getString("pending", "") + "," + a)).apply();
        }
    }

    private void drain() {
        SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String s = p.getString("pending", "");
        if (s.length() == 0) return;
        p.edit().remove("pending").apply();
        for (String a : s.split(",")) if (a.length() > 0 && !"plus30".equals(a)) emit(a);
    }
}
