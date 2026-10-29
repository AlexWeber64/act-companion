package io.github.alexweber64.actcompanion

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.text.Html
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewTreeObserver
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.lang.ref.WeakReference
import kotlin.concurrent.thread

/** The app's one screen: the dashboard from the Python server, in a WebView. */
class MainActivity : ComponentActivity() {
    companion object {
        const val PORT = 8765  // config.PORT
    }

    lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var ready = false  // keeps the launch screen up until the dashboard has loaded

    private val back = object : OnBackPressedCallback(false) {
        override fun handleOnBackPressed() = web.goBack()
    }
    private val askNotifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        Shell.activity = WeakReference(this)
        val bg = ContextCompat.getColor(this, R.color.bg)

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web = WebView(this).apply {
            setBackgroundColor(bg)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            addJavascriptInterface(Bridge(this@MainActivity), "ACTAndroid")
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val u = request.url
                    if (u.scheme == "http" && u.host == "127.0.0.1" && u.port == PORT) return false
                    openExternal(u)  // Moodle pages and other links open in the browser
                    return true
                }

                override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                    back.isEnabled = view.canGoBack()
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    if (url != null && url.startsWith("http://127.0.0.1")) reveal()
                }
            }
        }
        root = FrameLayout(this).apply {
            setBackgroundColor(bg)
            addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        }
        // The page sits between the status bar, navigation bar and keyboard; the bars take the theme's color.
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime()
            val bars = insets.getInsets(types)
            v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        setContentView(root)
        setBars(bg)
        root.viewTreeObserver.addOnPreDrawListener(object : ViewTreeObserver.OnPreDrawListener {
            override fun onPreDraw(): Boolean {
                if (!ready) return false
                root.viewTreeObserver.removeOnPreDrawListener(this)
                return true
            }
        })
        root.postDelayed(::reveal, 15_000)  // never hide a problem behind the launch screen
        onBackPressedDispatcher.addCallback(this, back)

        thread(name = "start") {
            try {
                val url = Shell.python().callAttr("start").toString()
                Shell.schedule(Shell.python().callAttr("interval_minutes").toInt())
                runOnUiThread { web.loadUrl(url) }
            } catch (e: Exception) {
                val msg = Html.escapeHtml(e.message ?: e.toString())
                val page = "<body style='background:#161826;color:#e6e6f0;font:16px sans-serif;padding:24px'>" +
                    "<h2>ACT Companion could not start</h2><p>$msg</p></body>"
                runOnUiThread {
                    web.loadDataWithBaseURL(null, page, "text/html", "utf-8", null)
                    reveal()
                }
            }
        }

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            askNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private fun reveal() {
        ready = true
        root.invalidate()
    }

    fun setBars(color: Int) {
        root.setBackgroundColor(color)
        val light = Color.luminance(color) > 0.5f
        WindowCompat.getInsetsController(window, root).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }

    fun openExternal(uri: Uri): Boolean = try {
        startActivity(Intent(Intent.ACTION_VIEW, uri))
        true
    } catch (e: ActivityNotFoundException) {
        false
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }
}
