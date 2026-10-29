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
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import java.lang.ref.WeakReference
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Alerts, scheduling the background checks, and quitting. */
object Shell {
    private const val CHANNEL = "alerts"
    private const val WORK = "checks"
    private const val MAX_INDIVIDUAL = 4  // a bigger burst becomes one summary, as on the desktop

    private lateinit var app: Context
    private val ids = AtomicInteger((System.currentTimeMillis() / 1000 % 100000).toInt())
    var activity = WeakReference<Activity>(null)

    fun init(context: Context) {
        app = context.applicationContext
        val channel = NotificationChannel(CHANNEL, app.getString(R.string.channel_alerts), NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = app.getString(R.string.channel_alerts_desc)
        app.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    /** Shows an alert. Tapping it opens the item on activity.act.edu. False if notifications are turned off. */
    fun notify(title: String, body: String, url: String?): Boolean {
        val manager = NotificationManagerCompat.from(app)
        if (!manager.areNotificationsEnabled()) return false
        val id = ids.incrementAndGet()
        val open = Intent(Intent.ACTION_VIEW, Uri.parse(url ?: Moodle.BASE)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
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

    fun notifyBatch(alerts: List<Checks.Alert>) {
        if (alerts.size > MAX_INDIVIDUAL) {
            val preview = alerts.take(3).joinToString("; ") { it.body }
            notify("ACT Companion: ${alerts.size} updates", "$preview; and more", Moodle.BASE)
            return
        }
        for (a in alerts) notify(a.title, a.body, a.url)
    }

    private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** (Re)schedules the background checks. Android runs them at most every 15 minutes, and only with a network. */
    fun schedule() {
        val request = PeriodicWorkRequestBuilder<CheckWorker>(Store.intervalMinutes(app).toLong(), TimeUnit.MINUTES)
            .setConstraints(network)
            .build()
        WorkManager.getInstance(app).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /** One check right away (sign in, Check now). */
    fun checkNow() {
        val request = OneTimeWorkRequestBuilder<CheckWorker>().setConstraints(network).build()
        WorkManager.getInstance(app).enqueueUniqueWork("check-now", ExistingWorkPolicy.KEEP, request)
    }

    /** When the next scheduled check runs, in seconds, or null if none is scheduled. */
    fun nextRun(): Double? = runCatching {
        WorkManager.getInstance(app).getWorkInfosForUniqueWork(WORK).get()
            .firstOrNull { it.state == WorkInfo.State.ENQUEUED }?.nextScheduleTimeMillis?.let { it / 1000.0 }
    }.getOrNull()

    /** Settings > Quit: stop the background checks until the app is opened again, and close it. */
    fun quit() {
        WorkManager.getInstance(app).cancelUniqueWork(WORK)
        activity.get()?.let { a -> a.runOnUiThread { a.finishAndRemoveTask() } }
    }
}
