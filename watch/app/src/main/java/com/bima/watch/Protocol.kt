package com.bima.watch

import java.io.ByteArrayOutputStream
import java.util.UUID

/**
 * The link to Bima on the computer: one GATT service, two characteristics.
 *   EVENT  watch → Bima (notify): commands and hello / battery
 *   STATE  Bima → watch (write):  live state, acks, haptic alerts, pairing
 *
 * Messages are small JSON objects split into 19-byte frames (1 header byte + 18 payload
 * bytes), so they fit the smallest BLE packet whatever MTU the two sides agree on.
 * Header bit 0x80 marks the last frame of a message. Keep this in sync with
 * src-tauri/src/remote.rs.
 */
object Proto {
    val SERVICE: UUID = UUID.fromString("9adc6dd9-e03e-4f67-9373-995d98b8dfad")
    val EVENT: UUID = UUID.fromString("703689a9-6b8d-4233-8928-0259e508909c")
    val STATE: UUID = UUID.fromString("867ca9fb-463e-4778-86d2-1b158a057588")
    val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    /** manufacturer-data key for the watch id in the scan response (0xFFFF: no company, testing) */
    const val MAKER = 0xFFFF

    /** scan-response payload: "id|name", at most 27 bytes (31 minus the AD header and company id) */
    fun tag(id: String, name: String): ByteArray {
        var out = "$id|$name".toByteArray(Charsets.UTF_8)
        var n = name
        while (out.size > 27 && n.isNotEmpty()) {
            n = n.dropLast(1)
            out = "$id|$n".toByteArray(Charsets.UTF_8)
        }
        return out
    }

    private const val PAYLOAD = 18
    private const val LAST: Int = 0x80

    fun frames(message: String): List<ByteArray> {
        val bytes = message.toByteArray(Charsets.UTF_8)
        if (bytes.isEmpty()) return emptyList()
        return bytes.toList().chunked(PAYLOAD).mapIndexed { i, chunk ->
            val last = (i + 1) * PAYLOAD >= bytes.size
            byteArrayOf((if (last) LAST else 0).toByte()) + chunk.toByteArray()
        }
    }

    /** Collects frames until a message is complete. */
    class Reassembler {
        private val buf = ByteArrayOutputStream()

        fun feed(frame: ByteArray): String? {
            if (frame.isEmpty()) return null
            buf.write(frame, 1, frame.size - 1)
            if (frame[0].toInt() and LAST == 0) {
                if (buf.size() > 4096) buf.reset() // garbage guard
                return null
            }
            val msg = buf.toString(Charsets.UTF_8.name())
            buf.reset()
            return msg
        }

        fun reset() = buf.reset()
    }
}
