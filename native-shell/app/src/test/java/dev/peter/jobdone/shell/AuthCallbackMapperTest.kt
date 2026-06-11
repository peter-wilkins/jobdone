package dev.peter.jobdone.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AuthCallbackMapperTest {
    @Test
    fun mapsNativeCallbackQueryToStagingWebUrl() {
        assertEquals(
            "https://jobdone-staging.vercel.app?code=abc&nativeShellAuthCallback=1",
            AuthCallbackMapper.toWebUrl("jobdone-staging://auth-callback?code=abc"),
        )
    }

    @Test
    fun mapsNativeCallbackFragmentToStagingWebUrl() {
        assertEquals(
            "https://jobdone-staging.vercel.app?nativeShellAuthCallback=1#access_token=abc&refresh_token=def",
            AuthCallbackMapper.toWebUrl("jobdone-staging://auth-callback#access_token=abc&refresh_token=def"),
        )
    }

    @Test
    fun ignoresOtherSchemesAndHosts() {
        assertNull(AuthCallbackMapper.toWebUrl("https://jobdone-staging.vercel.app"))
        assertNull(AuthCallbackMapper.toWebUrl("jobdone-staging://wrong?code=abc"))
        assertNull(AuthCallbackMapper.toWebUrl(""))
    }
}
