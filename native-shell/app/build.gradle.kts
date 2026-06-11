plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "dev.peter.jobdone.shell"
    compileSdk = 29

    defaultConfig {
        minSdk = 26
        targetSdk = 29
        versionCode = 1
        versionName = "0.1.0"
    }

    flavorDimensions += "environment"
    productFlavors {
        create("staging") {
            dimension = "environment"
            applicationId = "dev.peter.jobdone.shell.staging"
            manifestPlaceholders["authCallbackScheme"] = "jobdone-staging"
            resValue("string", "app_name", "JobDone Staging Shell")
            buildConfigField("String", "START_URL", "\"https://jobdone-staging.vercel.app\"")
            buildConfigField("String", "AUTH_CALLBACK_SCHEME", "\"jobdone-staging\"")
            buildConfigField("String", "AUTH_CALLBACK_HOST", "\"auth-callback\"")
            buildConfigField("String", "USER_AGENT_SUFFIX", "\" JobDoneNativeShell/0.1.0 staging\"")
            buildConfigField("String", "SHELL_LABEL", "\"JobDone staging shell\"")
        }
        create("production") {
            dimension = "environment"
            applicationId = "dev.peter.jobdone.shell.production"
            manifestPlaceholders["authCallbackScheme"] = "jobdone"
            resValue("string", "app_name", "JobDone Shell")
            buildConfigField("String", "START_URL", "\"https://jobdone.continuumkit.org\"")
            buildConfigField("String", "AUTH_CALLBACK_SCHEME", "\"jobdone\"")
            buildConfigField("String", "AUTH_CALLBACK_HOST", "\"auth-callback\"")
            buildConfigField("String", "USER_AGENT_SUFFIX", "\" JobDoneNativeShell/0.1.0 production\"")
            buildConfigField("String", "SHELL_LABEL", "\"JobDone production shell\"")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_1_8)
    }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}
