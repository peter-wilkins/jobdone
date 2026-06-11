package dev.peter.jobdone.shell

import org.junit.Assert.assertEquals
import org.junit.Test

class NavigationPolicyTest {
    @Test
    fun allowsJobDoneStagingInsideWebView() {
        assertEquals(
            NavigationDecision.WEBVIEW,
            NavigationPolicy.decide("https://jobdone-staging.vercel.app/team/example"),
        )
    }

    @Test
    fun opensExternalHttpsOutsidePrivilegedWebView() {
        assertEquals(
            NavigationDecision.EXTERNAL,
            NavigationPolicy.decide("https://example.com"),
        )
    }

    @Test
    fun blocksBlankUrls() {
        assertEquals(NavigationDecision.BLOCK, NavigationPolicy.decide(""))
    }

    @Test
    fun blocksUnknownSchemes() {
        assertEquals(NavigationDecision.BLOCK, NavigationPolicy.decide("mailto:test@example.com"))
    }
}
