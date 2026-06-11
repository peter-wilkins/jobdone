package dev.peter.jobdone.shell

import java.net.URI

enum class NavigationDecision {
    WEBVIEW,
    EXTERNAL,
    BLOCK,
}

object NavigationPolicy {
    private val webViewHost = runCatching { URI(JobDoneShellConfig.START_URL).host.lowercase() }.getOrNull()

    fun decide(url: String?): NavigationDecision {
        if (url.isNullOrBlank()) return NavigationDecision.BLOCK
        val uri = runCatching { URI(url) }.getOrNull() ?: return NavigationDecision.BLOCK
        val scheme = uri.scheme?.lowercase() ?: return NavigationDecision.BLOCK
        val host = uri.host?.lowercase()

        if (scheme != "https") return NavigationDecision.BLOCK
        if (host == webViewHost) return NavigationDecision.WEBVIEW
        return NavigationDecision.EXTERNAL
    }
}
