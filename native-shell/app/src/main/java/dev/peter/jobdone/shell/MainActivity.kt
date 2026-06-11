package dev.peter.jobdone.shell

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private lateinit var progress: ProgressBar
    private lateinit var status: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(255, 255, 255)
        window.navigationBarColor = Color.rgb(255, 255, 255)

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        val root = FrameLayout(this)
        webView = WebView(this).apply {
            layoutParams = FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT,
            )
            configureSettings(settings)
            webViewClient = JobDoneWebViewClient()
            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView?, newProgress: Int) {
                    this@MainActivity.progress.progress = newProgress
                    this@MainActivity.progress.visibility = if (newProgress in 1..99) View.VISIBLE else View.GONE
                }

                override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
                    if (BuildConfig.DEBUG) {
                        android.util.Log.d(
                            "JobDoneShellWeb",
                            "${consoleMessage.messageLevel()}: ${consoleMessage.message()} @ ${consoleMessage.sourceId()}:${consoleMessage.lineNumber()}",
                        )
                    }
                    return true
                }
            }
        }
        progress = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
        }
        status = TextView(this).apply {
            text = ""
            setTextColor(Color.rgb(95, 95, 95))
            setBackgroundColor(Color.WHITE)
            textSize = 12f
            setPadding(18, 10, 18, 10)
        }

        root.addView(webView)
        root.addView(progress, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            6,
        ))
        root.addView(status, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply {
            gravity = android.view.Gravity.BOTTOM
        })
        setContentView(root)

        if (savedInstanceState == null) {
            webView.loadUrl(JobDoneShellConfig.START_URL)
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    private fun configureSettings(settings: WebSettings) {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        settings.userAgentString = "${settings.userAgentString}${JobDoneShellConfig.USER_AGENT_SUFFIX}"
    }

    private inner class JobDoneWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
            handleNavigation(request?.url?.toString())

        @Suppress("DEPRECATION")
        override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean =
            handleNavigation(url)

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            status.text = if (BuildConfig.DEBUG) "JobDone staging shell" else ""
            super.onPageStarted(view, url, favicon)
        }

        private fun handleNavigation(url: String?): Boolean =
            when (NavigationPolicy.decide(url)) {
                NavigationDecision.WEBVIEW -> false
                NavigationDecision.EXTERNAL -> {
                    openExternal(url)
                    true
                }
                NavigationDecision.BLOCK -> true
            }
    }

    private fun openExternal(url: String?) {
        if (url.isNullOrBlank()) return
        if (BuildConfig.DEBUG) android.util.Log.d("JobDoneShell", "Opening external URL: $url")
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        }.onFailure {
            status.text = "Could not open external link."
        }
    }
}
