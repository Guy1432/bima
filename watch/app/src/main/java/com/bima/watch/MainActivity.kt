package com.bima.watch

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val permissions = buildList {
        if (Build.VERSION.SDK_INT >= 31) {
            add(Manifest.permission.BLUETOOTH_ADVERTISE)
            add(Manifest.permission.BLUETOOTH_CONNECT)
        }
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
    }.toTypedArray()

    private val missingPermission = MutableStateFlow(false)

    private val request = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        startRemote()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            RemoteApp(missingPermission = missingPermission, onGrant = { request.launch(permissions) })
        }
        // the screen stays on while Bima is connected, so the remote is always one tap away
        lifecycleScope.launch {
            RemoteHub.link.collect { link ->
                if (link == Link.CONNECTED) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
        if (granted()) startRemote() else request.launch(permissions)
    }

    private fun granted() = permissions.all {
        // notifications are nice to have; Bluetooth is required
        it == Manifest.permission.POST_NOTIFICATIONS ||
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    private fun startRemote() {
        missingPermission.value = !granted()
        if (!missingPermission.value) {
            ContextCompat.startForegroundService(this, Intent(this, RemoteService::class.java))
        }
    }
}
