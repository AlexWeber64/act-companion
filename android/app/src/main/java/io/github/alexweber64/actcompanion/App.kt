package io.github.alexweber64.actcompanion

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Shell.init(this)
    }
}
