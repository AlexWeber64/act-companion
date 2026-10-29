package io.github.alexweber64.actcompanion

import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import kotlin.concurrent.thread

/**
 * The page's window.ACTAndroid. app.js wraps it in the same API as the desktop window (desktop.py's Bridge):
 * web links open in the browser, course files are saved to Downloads/ACT Companion and opened.
 */
class Bridge(private val activity: MainActivity) {
    companion object {
        // Same list as desktop.py: anything else (scripts, programs, unknown types) is only saved, never opened.
        val SAFE_TO_OPEN = setOf("pdf", "doc", "docx", "odt", "rtf", "txt", "md", "ppt", "pptx", "odp", "key", "xls", "xlsx",
            "ods", "csv", "png", "jpg", "jpeg", "gif", "webp", "bmp", "mp3", "mp4", "m4a", "mov", "wav", "zip", "rar", "7z")
        private const val FOLDER = "ACT Companion"
    }

    private val key by lazy { Shell.python().callAttr("session_key").toString() }

    @JavascriptInterface
    fun openExternal(url: String): Boolean {
        val uri = Uri.parse(url)
        if (uri.scheme != "http" && uri.scheme != "https") return false
        return activity.openExternal(uri)
    }

    @JavascriptInterface
    fun openFile(href: String, filename: String, callback: String) {
        thread(name = "download") {
            val result = try {
                download(href, filename)
            } catch (e: Exception) {
                JSONObject().put("ok", false).put("error", "download failed (${e.javaClass.simpleName})")
            }
            activity.runOnUiThread {
                activity.web.evaluateJavascript("window.ACTAndroidDone(${JSONObject.quote(callback)}, $result)", null)
            }
        }
    }

    /** The page's background color ("rgb(22, 24, 38)"), so the system bars match the theme. */
    @JavascriptInterface
    fun setBars(css: String) {
        val rgb = Regex("""\d+""").findAll(css).take(3).map { it.value.toInt() }.toList()
        if (rgb.size == 3) activity.runOnUiThread { activity.setBars(Color.rgb(rgb[0], rgb[1], rgb[2])) }
    }

    @JavascriptInterface
    fun openAppSettings() {
        activity.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", activity.packageName, null)))
    }

    private fun failure(error: String) = JSONObject().put("ok", false).put("error", error)

    private fun download(href: String, filename: String): JSONObject {
        if (!href.startsWith("/api/file?")) return failure("not a course file")
        val conn = URL("http://127.0.0.1:${MainActivity.PORT}$href").openConnection() as HttpURLConnection
        conn.setRequestProperty("Cookie", "ac_session=$key")
        conn.connectTimeout = 10_000
        conn.readTimeout = 120_000
        try {
            if (conn.responseCode != 200) return failure("download failed (HTTP ${conn.responseCode})")
            val name = safeName(filename.ifBlank { nameFrom(conn.getHeaderField("Content-Disposition")) })
            val ext = name.substringAfterLast('.', "").lowercase()
            val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext) ?: "application/octet-stream"

            val resolver = activity.contentResolver
            val values = ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mime)
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$FOLDER")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
            val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return failure("could not save to Downloads")
            try {
                resolver.openOutputStream(uri)!!.use { out -> conn.inputStream.use { it.copyTo(out) } }
            } catch (e: Exception) {
                resolver.delete(uri, null, null)
                throw e
            }
            resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
            // Android renames duplicates ("notes (1).pdf"), so read back the name it chose.
            val saved = resolver.query(uri, arrayOf(MediaStore.Downloads.DISPLAY_NAME), null, null, null)
                ?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: name

            val result = JSONObject().put("ok", true).put("name", saved).put("opened", false)
            if (ext in SAFE_TO_OPEN) {
                val view = Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                try {
                    activity.startActivity(view)
                    result.put("opened", true)
                } catch (e: ActivityNotFoundException) {
                    result.put("error", "no app on this phone opens .$ext files")
                }
            }
            return result
        } finally {
            conn.disconnect()
        }
    }

    private fun nameFrom(disposition: String?): String {
        val m = Regex("""filename\*?=(?:UTF-8'')?"?([^";]+)""", RegexOption.IGNORE_CASE).find(disposition ?: "") ?: return "file"
        return URLDecoder.decode(m.groupValues[1], "UTF-8")
    }

    private fun safeName(name: String): String =
        name.replace(Regex("""[<>:"/\\|?*\x00-\x1f]"""), "_").trim(' ', '.').ifEmpty { "file" }.take(150)
}
