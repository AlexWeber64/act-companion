package io.github.alexweber64.actcompanion

import android.content.Context
import android.util.Log
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Background checks: new or unhidden course content, deadlines and reminders, and grades. A port of watcher.py, keeping
 * its state.json layout and its rules (the first pass only records a baseline, so nobody gets flooded with alerts).
 */
object Checks {
    private val running = AtomicBoolean(false)
    private const val RECENT_KEEP_SECONDS = 14 * 86400.0
    private const val RECENT_MAX = 100
    private val SKIP_MODS = setOf("label")  // text-only blocks, nothing to download

    class Alert(val title: String, val body: String, val url: String)

    /** One round of checks. True if it worked, false if it failed, null if another round was already running. */
    fun run(ctx: Context): Boolean? {
        if (!running.compareAndSet(false, true)) return null
        try {
            return runOnce(ctx)
        } finally {
            running.set(false)
        }
    }

    private fun now() = System.currentTimeMillis() / 1000.0

    private fun runOnce(ctx: Context): Boolean {
        val settings = Store.settings(ctx)
        val status = Store.status(ctx).put("last_run", now())
        val token = Store.get(ctx, "token")
        var st = Store.state(ctx)
        val out = mutableListOf<Alert>()
        try {
            val uid = (Moodle.call(token, "core_webservice_get_site_info") as JSONObject).getInt("userid")
            val enrolled = Moodle.call(token, "core_enrol_get_users_courses", mapOf("userid" to uid)) as JSONArray
            if (st.optInt("userid", -1) != uid) st = JSONObject().put("userid", uid)  // never mix two accounts' history
            val watch = settings.optJSONArray("watch_courses")?.let { w -> (0 until w.length()).map { w.getInt(it) }.toSet() }
            val courses = LinkedHashMap<Int, JSONObject>()
            for (i in 0 until enrolled.length()) {
                val c = enrolled.getJSONObject(i)
                if (watch == null || c.getInt("id") in watch) courses[c.getInt("id")] = c
            }
            val alerts = settings.getJSONObject("alerts")
            if (alerts.optBoolean("content")) for ((cid, c) in courses) checkContent(token, cid, shortName(c), st, out)
            if (alerts.optBoolean("deadlines")) checkDeadlines(token, courses, st, out, settings)
            if (alerts.optBoolean("grades")) checkGrades(token, courses, uid, st, out, settings)
        } catch (e: Moodle.AuthException) {
            val notLoggedIn = e.message.orEmpty().contains("not logged in")
            status.put("last_error", if (notLoggedIn) "Not logged in" else "Login expired")
            Store.saveStatus(ctx, status)
            val cur = Store.state(ctx)
            if (!cur.optBoolean("auth_alerted") && !notLoggedIn) {
                Shell.notify("ACT Companion needs you to sign in", "Your session expired. Open ACT Companion to sign in again.", null)
                Store.saveState(ctx, cur.put("auth_alerted", true))
            }
            return false
        } catch (e: Exception) {
            // Also anything unexpected in a reply (a wrong type, a bad number), as watcher.py records a ValueError.
            if (e !is Moodle.MoodleException && e !is IOException && e !is JSONException && e !is RuntimeException) throw e
            status.put("last_error", "${e.javaClass.simpleName}: ${e.message.orEmpty().take(200)}")
            Store.saveStatus(ctx, status)
            Log.w("ACTCompanion", "check failed: ${status.getString("last_error")}")
            return false
        }

        val t = now()
        st.put("auth_alerted", false)
        val recent = st.optJSONArray("recent") ?: JSONArray()
        val kept = JSONArray()
        for (i in 0 until recent.length()) {
            val r = recent.getJSONObject(i)
            if (t - r.optDouble("detected") < RECENT_KEEP_SECONDS && kept.length() < RECENT_MAX) kept.put(r)
        }
        st.put("recent", kept)
        Store.saveState(ctx, st)
        Shell.notifyBatch(out)
        Store.saveStatus(ctx, status.put("last_ok", t).put("last_error", JSONObject.NULL))
        return true
    }

    // ---- helpers --------------------------------------------------------------------------------------

    /** "CSC 192_VICTORATOS_2627FALL-V" -> "CSC 192". */
    fun shortName(course: JSONObject): String =
        course.str("shortname").split("_")[0].trim().ifEmpty { course.str("fullname").ifEmpty { "Course" } }

    private fun fmtTime(ts: Long) = SimpleDateFormat("EEE dd MMM, HH:mm", Locale.ENGLISH).format(Date(ts * 1000))

    private fun fmtLeft(seconds: Double) = when {
        seconds >= 5400 -> "${Math.rint(seconds / 3600).toInt()} hours"  // rint rounds halves to even, like Python's round()
        seconds >= 3600 -> "1 hour"
        else -> "${maxOf(1, Math.rint(seconds / 60).toInt())} minutes"
    }

    private fun JSONObject.obj(key: String): JSONObject = optJSONObject(key) ?: JSONObject().also { put(key, it) }

    /** A string field, with Moodle's nulls as "" (org.json would turn them into "null"). */
    private fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key)

    /** A field as stored in state.json: JSON null when Moodle sent none, as watcher.py stores None. */
    private fun JSONObject.orNull(key: String): Any = if (isNull(key)) JSONObject.NULL else get(key)

    // ---- course content -----------------------------------------------------------------------------

    /** Everything currently visible to this user in the course, by key. */
    private fun scanCourse(token: String?, cid: Int): JSONObject {
        val found = JSONObject()
        val sections = Moodle.call(token, "core_course_get_contents", mapOf("courseid" to cid)) as JSONArray
        for (i in 0 until sections.length()) {
            val mods = sections.getJSONObject(i).optJSONArray("modules") ?: continue
            for (j in 0 until mods.length()) {
                val m = mods.getJSONObject(j)
                if (m.str("modname") in SKIP_MODS || (m.has("uservisible") && !m.optBoolean("uservisible", true))) continue
                val url = m.str("url").ifEmpty { "${Moodle.BASE}/course/view.php?id=$cid" }
                val mkey = "m${m.getInt("id")}"
                val module = JSONObject().put("label", m.str("name")).put("url", url).put("ver", 0).put("kind", "resource")
                found.put(mkey, module)
                val contents = m.optJSONArray("contents") ?: JSONArray()
                for (k in 0 until contents.length()) {
                    val f = contents.getJSONObject(k)
                    if (f.str("type") != "file") continue
                    val key = "f${m.getInt("id")}/${f.str("filepath").ifEmpty { "/" }}${f.str("filename")}"
                    val ver = f.optLong("timemodified", 0)
                    found.put(key, JSONObject().put("label", f.str("filename")).put("url", url).put("ver", ver)
                        .put("kind", "file").put("module", mkey).put("fileurl", f.orNull("fileurl")))
                    if (!module.has("fileurl")) module.put("fileurl", f.orNull("fileurl"))
                    // A module's ver is its newest file's upload time, to tell "uploaded earlier, now unhidden" from "just uploaded".
                    module.put("ver", maxOf(module.optLong("ver"), ver))
                }
            }
        }
        val forums = Moodle.call(token, "mod_forum_get_forums_by_courses", mapOf("courseids" to listOf(cid))) as JSONArray
        for (i in 0 until forums.length()) {
            val forum = forums.getJSONObject(i)
            val disc = Moodle.call(token, "mod_forum_get_forum_discussions", mapOf("forumid" to forum.getInt("id"), "perpage" to 30)) as JSONObject
            val list = disc.optJSONArray("discussions") ?: JSONArray()
            for (j in 0 until list.length()) {
                val d = list.getJSONObject(j)
                val did = d.getInt("discussion")
                found.put("d$did", JSONObject().put("label", "${forum.str("name")}: ${d.str("name")}")
                    .put("ver", d.optLong("timemodified", 0)).put("url", "${Moodle.BASE}/mod/forum/discuss.php?d=$did").put("kind", "discussion"))
            }
        }
        return found
    }

    /** Fetches posts only for discussions that are new or changed, and collects their attachments. */
    private fun scanAttachments(token: String?, found: JSONObject, old: JSONObject?) {
        for (key in found.keys().asSequence().toList()) {
            val item = found.getJSONObject(key)
            if (item.str("kind") != "discussion") continue
            if (old != null && old.optJSONObject(key)?.optLong("ver", -1) == item.optLong("ver")) continue
            val posts = (Moodle.call(token, "mod_forum_get_discussion_posts", mapOf("discussionid" to key.drop(1).toInt())) as JSONObject)
                .optJSONArray("posts") ?: JSONArray()
            for (i in 0 until posts.length()) {
                val p = posts.getJSONObject(i)
                val atts = p.optJSONArray("attachments") ?: continue
                for (j in 0 until atts.length()) {
                    val a = atts.getJSONObject(j)
                    found.put("a${p.getInt("id")}/${a.str("filename")}", JSONObject().put("label", a.str("filename"))
                        .put("url", item.str("url")).put("ver", a.optLong("timemodified", 0)).put("kind", "attachment")
                        .put("fileurl", a.orNull("fileurl")))
                }
            }
        }
        // Attachments of discussions not re-fetched are unchanged; keep them so they are not "new" next time.
        if (old != null) for (k in old.keys()) if (k.startsWith("a") && !found.has(k)) found.put(k, old.get(k))
    }

    private fun checkContent(token: String?, cid: Int, cname: String, st: JSONObject, out: MutableList<Alert>) {
        val items = st.obj("items")
        val checked = st.obj("checked")
        val old = items.optJSONObject(cid.toString())
        val found = scanCourse(token, cid)
        scanAttachments(token, found, old)
        val t = now()
        if (old == null) {
            items.put(cid.toString(), found)
            checked.put(cid.toString(), t)
            return
        }
        val lastCheck = checked.optDouble(cid.toString(), t - 600)
        val newModules = found.keys().asSequence().filter { it.startsWith("m") && !old.has(it) }.toSet()
        val recent = st.optJSONArray("recent") ?: JSONArray()
        val fresh = mutableListOf<JSONObject>()
        for (key in found.keys()) {
            val item = found.getJSONObject(key)
            val kind = item.str("kind")
            val ver = item.optLong("ver")
            val title = when {
                old.has(key) -> if ((kind == "file" || kind == "attachment") && ver > old.getJSONObject(key).optLong("ver")) "Updated file" else continue
                kind == "discussion" -> "New post"
                kind == "file" && item.str("module") in newModules -> continue  // announced together with its new module
                // Uploaded before the previous check but only visible now means it was hidden and got unhidden.
                else -> (if (ver > 0 && ver < lastCheck - 120) "Now visible: " else "New ") + kind
            }
            out += Alert("$cname: $title", item.str("label"), item.str("url"))
            fresh += JSONObject().put("course", cid).put("title", title).put("label", item.str("label"))
                .put("url", item.str("url")).put("fileurl", item.opt("fileurl") ?: JSONObject.NULL).put("detected", t)
        }
        val merged = JSONArray()
        fresh.asReversed().forEach { merged.put(it) }  // newest first, as watcher.py inserts them
        for (i in 0 until recent.length()) merged.put(recent.get(i))
        st.put("recent", merged)
        items.put(cid.toString(), found)
        checked.put(cid.toString(), t)
    }

    // ---- deadlines ----------------------------------------------------------------------------------

    private fun checkDeadlines(token: String?, courses: Map<Int, JSONObject>, st: JSONObject, out: MutableList<Alert>, settings: JSONObject) {
        val t = now()
        val events = (Moodle.call(token, "core_calendar_get_action_events_by_timesort", mapOf(
            "timesortfrom" to t.toLong() - 3600, "timesortto" to t.toLong() + 60 * 86400, "limitnum" to 50)) as JSONObject)
            .optJSONArray("events") ?: JSONArray()
        val first = !st.has("events")
        val known = st.optJSONObject("events") ?: JSONObject()
        val hoursArr = settings.optJSONArray("reminder_hours") ?: JSONArray()
        val hours = (0 until hoursArr.length()).map { hoursArr.getDouble(it) }.filter { it > 0 }.sorted()
        val seen = JSONObject()
        for (i in 0 until events.length()) {
            val e = events.getJSONObject(i)
            val cid = e.optJSONObject("course")?.optInt("id") ?: continue
            val course = courses[cid] ?: continue
            if (e.optJSONObject("action")?.let { it.opt("actionable") == false } == true) continue  // already done
            val eid = e.get("id").toString()
            val due = e.getLong("timesort")
            val cname = shortName(course)
            val rec = known.optJSONObject(eid)?.let { JSONObject(it.toString()) } ?: JSONObject().put("reminded", JSONArray())
            val reminded = rec.getJSONArray("reminded").let { r -> (0 until r.length()).map { r.getDouble(it) }.toMutableSet() }
            val url = e.str("url").ifEmpty { "${Moodle.BASE}/course/view.php?id=$cid" }
            val left = due - t
            val crossed = hours.filter { left > 0 && left <= it * 3600 && it !in reminded }
            val isNew = !known.has(eid) && !first
            val name = e.str("name")
            when {
                isNew && crossed.isNotEmpty() -> out += Alert("$cname: New deadline, due in ${fmtLeft(left)}", name, url)
                isNew -> out += Alert("$cname: New deadline", "$name (due ${fmtTime(due)})", url)
                crossed.isNotEmpty() -> out += Alert("$cname: Due in ${fmtLeft(left)}", name, url)  // one reminder even if several passed
            }
            if (crossed.isNotEmpty()) {
                reminded += hours.filter { left <= it * 3600 }
                rec.put("reminded", JSONArray(reminded.sorted()))
            }
            seen.put(eid, rec.put("name", name).put("due", due))
        }
        st.put("events", seen)
    }

    // ---- grades -------------------------------------------------------------------------------------

    private fun checkGrades(token: String?, courses: Map<Int, JSONObject>, uid: Int, st: JSONObject, out: MutableList<Alert>, settings: JSONObject) {
        val t = now()
        if (t - st.optDouble("grades_checked", 0.0) < settings.optDouble("grades_interval_minutes", 15.0) * 60) return
        val grades = st.obj("grades")
        val based = st.obj("grades_baselined")
        for ((cid, course) in courses) {
            val r = Moodle.call(token, "gradereport_user_get_grade_items", mapOf("courseid" to cid, "userid" to uid)) as JSONObject
            val ugs = r.optJSONArray("usergrades") ?: JSONArray()
            for (i in 0 until ugs.length()) {
                val items = ugs.getJSONObject(i).optJSONArray("gradeitems") ?: continue
                for (j in 0 until items.length()) {
                    val gi = items.getJSONObject(j)
                    if (gi.str("itemtype") in setOf("course", "category")) continue  // totals move whenever any item is graded
                    val key = "$cid:${gi.get("id")}"
                    val v = gi.str("gradeformatted").trim()
                    val prev = if (grades.has(key)) grades.str(key) else null
                    if (based.optBoolean(cid.toString()) && v != "" && v != "-" && v != prev) {
                        val title = if (prev != null && prev != "" && prev != "-") "Grade updated" else "New grade"
                        var body = gi.str("itemname").ifEmpty { "Grade item" }
                        if (settings.optBoolean("grades_show_value")) body += ": $v"
                        out += Alert("${shortName(course)}: $title", body, "${Moodle.BASE}/grade/report/user/index.php?id=$cid")
                    }
                    grades.put(key, v)
                }
            }
            based.put(cid.toString(), true)
        }
        st.put("grades_checked", t)
    }
}
