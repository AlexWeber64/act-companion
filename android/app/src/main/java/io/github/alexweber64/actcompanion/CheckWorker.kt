package io.github.alexweber64.actcompanion

import android.content.Context
import android.util.Log
import androidx.work.Worker
import androidx.work.WorkerParameters

/** One scheduled round of checks (deadlines, reminders, grades), run by WorkManager even when the app is closed. */
class CheckWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        try {
            Shell.python().callAttr("check")
        } catch (e: Exception) {
            Log.e("ACTCompanion", "check crashed", e)
        }
        return Result.success()  // a failed check is logged and shown in Settings; the next one runs on schedule
    }
}
