package io.github.alexweber64.actcompanion

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import com.chaquo.python.PyObject
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import java.lang.ref.WeakReference
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** What the Python side (act_companion/android.py and notify.py) calls: alerts, scheduling and quitting. */
object Shell {
    private const val CHANNEL = "alerts"
    private const val WORK = "checks"
    const val SITE = "https://activity.act.edu"

    private lateinit var app: Context
    private val ids = AtomicInteger((System.currentTimeMillis() / 1000 % 100000).toInt())
    var activity = WeakReference<Activity>(null)

    fun init(context: Context) {
        app = context.applicationContext
        val channel = NotificationChannel(CHANNEL, app.getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = app.getString(R.string.channel_alerts_desc)
        app.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    /** act_companion/android.py, starting Python first if needed. Call it off the main thread. */
    @Synchronized
    fun python(): PyObject {
        if (!Python.isStarted()) Python.start(AndroidPlatform(app))
        return Python.getInstance().getModule("act_companion.android")
    }

    /** Shows an alert. Tapping it opens the item on activity.act.edu. False if notifications are turned off. */
    @JvmStatic
    fun notify(title: String, body: String, url: String?): Boolean {
        val manager = NotificationManagerCompat.from(app)
        if (!manager.areNotificationsEnabled()) return false
        val id = ids.incrementAndGet()
        val open = Intent(Intent.ACTION_VIEW, Uri.parse(url ?: SITE)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        val notification = NotificationCompat.Builder(app, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(PendingIntent.getActivity(app, id, open, PendingIntent.FLAG_IMMUTABLE))
            .setAutoCancel(true)
            .build()
        return try {
            manager.notify(id, notification)
            true
        } catch (e: SecurityException) {
            false
        }
    }

    /** (Re)schedules the background checks. Android runs them at most every 15 minutes, and only with a network. */
    @JvmStatic
    fun schedule(minutes: Int) {
        val request = PeriodicWorkRequestBuilder<CheckWorker>(minutes.toLong(), TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(app).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /** Settings > Quit: stop the background checks until the app is opened again, and close it. */
    @JvmStatic
    fun quit() {
        WorkManager.getInstance(app).cancelUniqueWork(WORK)
        activity.get()?.let { a -> a.runOnUiThread { a.finishAndRemoveTask() } }
    }
}
