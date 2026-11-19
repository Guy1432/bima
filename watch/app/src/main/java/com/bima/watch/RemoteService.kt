package com.bima.watch

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.ParcelUuid
import androidx.core.app.NotificationCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import org.json.JSONObject
import java.util.ArrayDeque
import java.util.UUID

/**
 * Keeps the watch reachable by Bima for the whole talk (foreground service): a BLE GATT
 * server that advertises the Bima service while nobody is connected.
 */
@SuppressLint("MissingPermission") // permissions are granted in MainActivity before start
class RemoteService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private lateinit var manager: BluetoothManager
    private var server: BluetoothGattServer? = null
    private var event: BluetoothGattCharacteristic? = null
    private var central: BluetoothDevice? = null
    private var subscribed = false
    private val inbox = Proto.Reassembler()
    private val outbox = ArrayDeque<ByteArray>()
    private var sending = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundNotice()
        RemoteHub.haptics = Haptics(this)
        RemoteHub.sender = { msg -> main.post { queue(msg) } }
        manager = getSystemService(BluetoothManager::class.java)
        start()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int) = START_STICKY

    override fun onDestroy() {
        stopAdvertising()
        server?.close()
        server = null
        RemoteHub.sender = null
        RemoteHub.link.value = Link.OFF
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    // ------------------------------------------------------------------ setup

    private fun start() {
        val adapter = manager.adapter
        if (adapter == null || !adapter.isEnabled) {
            RemoteHub.link.value = Link.NO_BLUETOOTH
            main.postDelayed({ start() }, 3000) // try again once Bluetooth is back
            return
        }
        if (adapter.bluetoothLeAdvertiser == null) {
            RemoteHub.link.value = Link.UNSUPPORTED
            return
        }
        val gatt = manager.openGattServer(this, callback) ?: run {
            RemoteHub.link.value = Link.UNSUPPORTED
            return
        }
        val service = BluetoothGattService(Proto.SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        event = BluetoothGattCharacteristic(
            Proto.EVENT,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ,
        ).apply {
            addDescriptor(
                BluetoothGattDescriptor(
                    Proto.CCCD,
                    BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE,
                ),
            )
        }
        val state = BluetoothGattCharacteristic(
            Proto.STATE,
            BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE,
            BluetoothGattCharacteristic.PERMISSION_WRITE,
        )
        service.addCharacteristic(event)
        service.addCharacteristic(state)
        gatt.addService(service)
        server = gatt
        startAdvertising()
    }

    private val advertiseCallback = object : AdvertiseCallback() {
        override fun onStartFailure(errorCode: Int) {
            android.util.Log.w("Bima", "advertising failed: $errorCode")
            when (errorCode) {
                ADVERTISE_FAILED_ALREADY_STARTED -> Unit
                ADVERTISE_FAILED_FEATURE_UNSUPPORTED -> RemoteHub.link.value = Link.UNSUPPORTED
                // busy radio / too many advertisers: try again shortly
                else -> main.postDelayed({ if (central == null) startAdvertising() }, 2000)
            }
        }
    }

    private fun startAdvertising() {
        val adv = manager.adapter?.bluetoothLeAdvertiser ?: return
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM)
            .setConnectable(true)
            .build()
        val data = AdvertiseData.Builder().addServiceUuid(ParcelUuid(Proto.SERVICE)).build()
        // "id|name" rides in the scan response (31-byte limit, so a short name), letting Bima
        // know its own watch and show a friendly name without connecting
        val scan = AdvertiseData.Builder().addManufacturerData(Proto.MAKER, Proto.tag(watchId(), shortName())).build()
        runCatching { adv.startAdvertising(settings, data, scan, advertiseCallback) }
        if (central == null) RemoteHub.link.value = Link.WAITING
    }

    private fun stopAdvertising() {
        runCatching { manager.adapter?.bluetoothLeAdvertiser?.stopAdvertising(advertiseCallback) }
    }

    // ------------------------------------------------------------------ GATT

    private val callback = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            main.post {
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    central = device
                    stopAdvertising() // one computer at a time
                } else if (device == central) {
                    val wasLinked = RemoteHub.link.value == Link.CONNECTED
                    central = null
                    subscribed = false
                    outbox.clear()
                    sending = false
                    inbox.reset()
                    if (wasLinked) RemoteHub.haptics?.play(Feel.LOST)
                    startAdvertising()
                }
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice, requestId: Int, descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray,
        ) {
            if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            main.post {
                if (descriptor.uuid == Proto.CCCD && device == central) {
                    subscribed = value.isNotEmpty() && value[0].toInt() != 0
                    if (subscribed) {
                        RemoteHub.link.value = Link.CONNECTED
                        RemoteHub.haptics?.play(Feel.LINKED)
                        queue(hello())
                        scheduleBattery()
                    }
                }
            }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice, requestId: Int, characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray,
        ) {
            if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            if (characteristic.uuid != Proto.STATE) return
            main.post { inbox.feed(value)?.let(RemoteHub::receive) }
        }

        override fun onCharacteristicReadRequest(
            device: BluetoothDevice, requestId: Int, offset: Int, characteristic: BluetoothGattCharacteristic,
        ) {
            server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, ByteArray(0))
        }

        override fun onNotificationSent(device: BluetoothDevice, status: Int) {
            main.post {
                sending = false
                pump()
            }
        }
    }

    /** Notifications must go one at a time: the next frame waits for onNotificationSent. */
    private fun queue(message: String) {
        if (!subscribed) return
        outbox.addAll(Proto.frames(message))
        pump()
    }

    private fun pump() {
        if (sending) return
        val device = central ?: return
        val ch = event ?: return
        val frame = outbox.poll() ?: return
        sending = true
        val ok = if (Build.VERSION.SDK_INT >= 33) {
            server?.notifyCharacteristicChanged(device, ch, false, frame) == BluetoothGatt.GATT_SUCCESS
        } else {
            @Suppress("DEPRECATION")
            ch.value = frame
            @Suppress("DEPRECATION")
            server?.notifyCharacteristicChanged(device, ch, false) == true
        }
        if (!ok) {
            sending = false
            main.postDelayed({ pump() }, 20)
            outbox.addFirst(frame)
        }
    }

    // ------------------------------------------------------------------ identity + battery

    private fun watchId(): String {
        val prefs = getSharedPreferences("bima", Context.MODE_PRIVATE)
        return prefs.getString("id", null) ?: UUID.randomUUID().toString().take(8).also {
            prefs.edit().putString("id", it).apply()
        }
    }

    /** "Galaxy Watch8 (TVAE)" → "Galaxy Watch8" */
    private fun shortName(): String {
        val n = runCatching { android.provider.Settings.Global.getString(contentResolver, "device_name") }.getOrNull()
        return (n ?: Build.MODEL).substringBefore(" (").ifBlank { "Galaxy Watch" }
    }

    private fun battery() = getSystemService(BatteryManager::class.java)
        .getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)

    private fun hello() = JSONObject()
        .put("t", "hi")
        .put("v", 1)
        .put("id", watchId())
        .put("n", shortName())
        .put("bat", battery())
        .toString()

    private fun scheduleBattery() {
        main.postDelayed({
            if (RemoteHub.link.value == Link.CONNECTED) {
                queue(JSONObject().put("t", "bat").put("v", battery()).toString())
                scheduleBattery()
            }
        }, 5 * 60_000L)
    }

    // ------------------------------------------------------------------ foreground notice

    private fun startForegroundNotice() {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel("remote", getString(R.string.service_channel), NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        val builder = NotificationCompat.Builder(this, "remote")
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(getString(R.string.service_text))
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
        // the watch face shows a Bima icon while the remote runs; tap returns to it
        OngoingActivity.Builder(this, 1, builder)
            .setStaticIcon(R.drawable.ic_launcher_foreground)
            .setTouchIntent(open)
            .setStatus(Status.Builder().addTemplate(getString(R.string.service_text)).build())
            .build()
            .apply(this)
        val notification: Notification = builder.build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(1, notification)
        }
    }
}
