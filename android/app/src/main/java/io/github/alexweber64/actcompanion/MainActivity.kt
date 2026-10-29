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
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewTreeObserver
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
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
import androidx.webkit.WebViewAssetLoader
import java.lang.ref.WeakReference

/**
 * The app's one screen: the web app (web/, built into the APK's assets) in a WebView. web.js talks to activity.act.edu
 * directly, so the screen does not wait for anything to start.
 */
class MainActivity : ComponentActivity() {
    companion object {
        private const val HOST = "appassets.androidplatform.net"  // WebViewAssetLoader's origin for the app's own files
        private const val START = "https://$HOST/assets/web/index.html"
    }

    lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var ready = false  // keeps the launch screen up until the page has loaded

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
        val assets = WebViewAssetLoader.Builder().addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this)).build()

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        web = WebView(this).apply {
            setBackgroundColor(bg)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            addJavascriptInterface(Bridge(this@MainActivity), "ACTAndroid")
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)

                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == HOST) return false
                    openExternal(request.url)  // Moodle pages and other links open in the browser
                    return true
                }

                override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                    back.isEnabled = view.canGoBack()
                }

                override fun onPageFinished(view: WebView, url: String?) {
                    reveal()
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
        root.postDelayed(::reveal, 5_000)  // never hide a problem behind the launch screen
        onBackPressedDispatcher.addCallback(this, back)

        web.loadUrl(START)
        Shell.schedule()

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
