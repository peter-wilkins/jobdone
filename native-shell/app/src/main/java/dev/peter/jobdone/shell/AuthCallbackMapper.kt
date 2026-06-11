package dev.peter.jobdone.shell

import java.net.URI

object AuthCallbackMapper {
    fun toWebUrl(uriText: String?): String? {
        if (uriText.isNullOrBlank()) return null
        val uri = runCatching { URI(uriText) }.getOrNull() ?: return null
        if (uri.scheme != JobDoneShellConfig.AUTH_CALLBACK_SCHEME) return null
        if (uri.host != JobDoneShellConfig.AUTH_CALLBACK_HOST) return null

        val query = uri.rawQuery?.let { "?$it" } ?: ""
        val fragment = uri.rawFragment?.let { "#$it" } ?: ""
        return "${JobDoneShellConfig.START_URL}$query$fragment"
    }
}
