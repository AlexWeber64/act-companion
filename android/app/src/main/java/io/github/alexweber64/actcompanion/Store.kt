package io.github.alexweber64.actcompanion

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The app's private storage: the Moodle token and settings (written by web.js through the bridge), what the checks
 * have seen (state.json, like the desktop app's), and the status of the last check. Backups are off for all of it.
 */
object Store {
    /** The only keys the page may read and write. */
    val PAGE_KEYS = setOf("token", "settings")

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("act-companion", Context.MODE_PRIVATE)

    fun get(ctx: Context, key: String): String? = prefs(ctx).getString(key, null)

    fun set(ctx: Context, key: String, value: String?) {
        prefs(ctx).edit().apply { if (value == null) remove(key) else putString(key, value) }.commit()
    }

    /** The saved settings over the defaults (the same defaults as config.py and web.js). */
    fun settings(ctx: Context): JSONObject {
        val s = JSONObject()
            .put("watch_courses", JSONObject.NULL)
            .put("interval_minutes", 5)
            .put("grades_interval_minutes", 15)
            .put("alerts", JSONObject().put("content", false).put("deadlines", true).put("grades", true))
            .put("reminder_hours", JSONArray(listOf(24, 1)))
            .put("grades_show_value", false)
        val saved = runCatching { JSONObject(get(ctx, "settings") ?: "{}") }.getOrDefault(JSONObject())
        for (k in saved.keys()) {
            if (k == "alerts") {
                val a = saved.optJSONObject(k) ?: continue
                for (name in a.keys()) if (s.getJSONObject("alerts").has(name)) s.getJSONObject("alerts").put(name, a.optBoolean(name))
            } else if (s.has(k)) {
                s.put(k, saved.get(k))
            }
        }
        return s
    }

    fun intervalMinutes(ctx: Context) = maxOf(15, settings(ctx).optInt("interval_minutes", 15))

    private fun stateFile(ctx: Context) = File(ctx.filesDir, "state.json")

    fun state(ctx: Context): JSONObject = runCatching { JSONObject(stateFile(ctx).readText()) }.getOrDefault(JSONObject())

    fun saveState(ctx: Context, state: JSONObject) {
        val tmp = File(ctx.filesDir, "state.json.tmp")
        tmp.writeText(state.toString())
        tmp.renameTo(stateFile(ctx))
    }

    fun clearState(ctx: Context) {
        stateFile(ctx).delete()
        prefs(ctx).edit().remove("status").commit()
    }

    /** last_run, last_ok, last_error (times in seconds, as the desktop app reports them). */
    fun status(ctx: Context): JSONObject = runCatching { JSONObject(get(ctx, "status") ?: "{}") }.getOrDefault(JSONObject())

    fun saveStatus(ctx: Context, status: JSONObject) = set(ctx, "status", status.toString())
}
