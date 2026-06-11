package dev.peter.jobdone.shell

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AuthCallbackMapperTest {
    @Test
    fun mapsNativeCallbackQueryToStagingWebUrl() {
        assertEquals(
            "${JobDoneShellConfig.START_URL}?code=abc&nativeShellAuthCallback=1",
            AuthCallbackMapper.toWebUrl("${JobDoneShellConfig.AUTH_CALLBACK_SCHEME}://auth-callback?code=abc"),
        )
    }

    @Test
    fun mapsNativeCallbackFragmentToStagingWebUrl() {
        assertEquals(
            "${JobDoneShellConfig.START_URL}?nativeShellAuthCallback=1#access_token=abc&refresh_token=def",
            AuthCallbackMapper.toWebUrl("${JobDoneShellConfig.AUTH_CALLBACK_SCHEME}://auth-callback#access_token=abc&refresh_token=def"),
        )
    }

    @Test
    fun ignoresOtherSchemesAndHosts() {
        assertNull(AuthCallbackMapper.toWebUrl(JobDoneShellConfig.START_URL))
        assertNull(AuthCallbackMapper.toWebUrl("${JobDoneShellConfig.AUTH_CALLBACK_SCHEME}://wrong?code=abc"))
        assertNull(AuthCallbackMapper.toWebUrl(""))
    }
}
