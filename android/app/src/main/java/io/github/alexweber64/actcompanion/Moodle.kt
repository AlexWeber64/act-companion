package io.github.alexweber64.actcompanion

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Minimal Moodle Web Services client for the background checks (the screens use web.js). Mirrors moodle.py. */
object Moodle {
    const val BASE = "https://activity.act.edu"

    open class MoodleException(message: String) : Exception(message)

    /** The token is missing, expired or revoked. The user must sign in again. */
    class AuthException(message: String) : MoodleException(message)

    /** Calls a web service function and returns the decoded JSON (a JSONObject, JSONArray or plain value). */
    fun call(token: String?, function: String, params: Map<String, Any?> = emptyMap()): Any {
        if (token.isNullOrEmpty()) throw AuthException("not logged in")
        val form = mutableListOf("wstoken" to token, "wsfunction" to function)
        flatten(params, "", form)
        val body = form.joinToString("&") { (k, v) -> URLEncoder.encode(k, "UTF-8") + "=" + URLEncoder.encode(v, "UTF-8") }
        val conn = URL("$BASE/webservice/rest/server.php?moodlewsrestformat=json").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.doOutput = true
            conn.connectTimeout = 30_000
            conn.readTimeout = 60_000
            conn.setRequestProperty("Content-Type", "application/x-www-form-urlencoded")
            conn.outputStream.use { it.write(body.toByteArray()) }
            val code = conn.responseCode
            val text = (if (code < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            // A maintenance or proxy error page is not JSON; report it like any other failed check.
            val data = runCatching { JSONTokener(text).nextValue() }.getOrNull()
            if (data !is JSONObject && data !is JSONArray && (code >= 400 || data == null)) throw MoodleException("unexpected response (HTTP $code)")
            if (data is JSONObject && data.has("exception")) {
                val err = data.optString("errorcode")
                if (err == "invalidtoken") throw AuthException("$err: ${data.optString("message")}")
                throw MoodleException("$err: ${data.optString("message")}")
            }
            return data ?: throw MoodleException("empty response (HTTP $code)")
        } finally {
            conn.disconnect()
        }
    }

    /** Nested lists and maps become Moodle's courseids[0]=1 style form fields. */
    private fun flatten(params: Map<*, *>, prefix: String, out: MutableList<Pair<String, String>>) {
        for ((k, v) in params) {
            val key = if (prefix.isEmpty()) k.toString() else "$prefix[$k]"
            when (v) {
                null -> {}
                is Map<*, *> -> flatten(v, key, out)
                is List<*> -> flatten(v.withIndex().associate { it.index to it.value }, key, out)
                else -> out += key to v.toString()
            }
        }
    }
}
