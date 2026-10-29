package io.github.alexweber64.actcompanion

import android.app.Application
import kotlin.concurrent.thread

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Shell.init(this)
        // Python takes a few seconds to start on slow phones: start it alongside the screen instead of before it.
        thread(name = "python") { Shell.python() }
    }
}
