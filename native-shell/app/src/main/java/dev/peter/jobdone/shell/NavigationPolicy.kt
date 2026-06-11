package dev.peter.jobdone.shell

import java.net.URI

enum class NavigationDecision {
    WEBVIEW,
    EXTERNAL,
    BLOCK,
}

object NavigationPolicy {
    private val webViewHosts = setOf(
        "jobdone-staging.vercel.app",
        "jobdone-frontend-staging.vercel.app",
    )

    fun decide(url: String?): NavigationDecision {
        if (url.isNullOrBlank()) return NavigationDecision.BLOCK
        val uri = runCatching { URI(url) }.getOrNull() ?: return NavigationDecision.BLOCK
        val scheme = uri.scheme?.lowercase() ?: return NavigationDecision.BLOCK
        val host = uri.host?.lowercase()

        if (scheme != "https") return NavigationDecision.BLOCK
        if (host in webViewHosts) return NavigationDecision.WEBVIEW
        return NavigationDecision.EXTERNAL
    }
}
