package com.legacy.fitness;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class RestActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String a = intent.getStringExtra("a");
        if (a != null) WorkoutNotifPlugin.deliver(context, a);
    }
}
