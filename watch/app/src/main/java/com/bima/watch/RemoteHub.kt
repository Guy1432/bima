package com.bima.watch

import android.os.SystemClock
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONObject

enum class Link { OFF, WAITING, CONNECTED, NO_BLUETOOTH, UNSUPPORTED }

/** What Bima reports about the show. `at` = when it arrived (to keep the clock running). */
data class Show(
    val index: Int = 0,
    val total: Int = 0,
    val item: String = "",
    val next: String = "",
    val blackout: String = "none",
    val media: Boolean = false,
    val playing: Boolean = false,
    val elapsed: Long = 0,
    val target: Long = 0,
    val projector: Boolean = false,
    val at: Long = SystemClock.elapsedRealtime(),
) {
    fun elapsedNow(now: Long = SystemClock.elapsedRealtime()) = elapsed + (now - at) / 1000
}

data class PairRequest(val code: String, val pc: String)

/** Shared between the Bluetooth service and the UI. */
object RemoteHub {
    val link = MutableStateFlow(Link.OFF)
    val show = MutableStateFlow(Show())
    val pc = MutableStateFlow<String?>(null)
    val pair = MutableStateFlow<PairRequest?>(null)

    /** set by the service while it runs */
    @Volatile var sender: ((String) -> Unit)? = null
    @Volatile var haptics: Haptics? = null

    private var seq = 0
    private val pending = mutableMapOf<Int, String>()

    val linkState: StateFlow<Link> get() = link

    /** A command to Bima. The watch only buzzes once Bima confirms it. */
    fun command(c: String, a: String? = null) {
        if (link.value != Link.CONNECTED) {
            haptics?.play(Feel.FAILED)
            return
        }
        val s = synchronized(this) { ++seq }
        val msg = JSONObject().put("t", "c").put("s", s).put("c", c)
        if (a != null) msg.put("a", a)
        synchronized(pending) { pending[s] = c }
        sender?.invoke(msg.toString())
        // no answer in time → tell the wrist it didn't happen
        android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
            val missed = synchronized(pending) { pending.remove(s) } != null
            if (missed) haptics?.play(Feel.FAILED)
        }, 900)
    }

    fun answerPair(accept: Boolean) {
        val req = pair.value ?: return
        pair.value = null
        sender?.invoke(JSONObject().put("t", if (accept) "pair_ok" else "pair_no").put("code", req.code).toString())
        if (accept) pc.value = req.pc
    }

    /** A message from Bima. */
    fun receive(raw: String) {
        val m = runCatching { JSONObject(raw) }.getOrNull() ?: return
        when (m.optString("t")) {
            "st" -> show.value = Show(
                index = m.optInt("i"),
                total = m.optInt("n"),
                item = m.optString("it"),
                next = m.optString("nx"),
                blackout = m.optString("bk", "none"),
                media = m.optInt("md") == 1,
                playing = m.optInt("pl") == 1,
                elapsed = m.optLong("el"),
                target = m.optLong("tl"),
                projector = m.optInt("pj") == 1,
            ).also { if (m.has("pc")) pc.value = m.optString("pc") }
            "ack" -> {
                val kind = synchronized(pending) { pending.remove(m.optInt("s")) } ?: return
                if (m.optInt("ok", 1) != 1) return haptics?.play(Feel.FAILED) ?: Unit
                haptics?.play(
                    when (kind) {
                        "next" -> Feel.NEXT
                        "prev" -> Feel.PREV
                        "black", "white" -> if (m.optString("bk") == "none") Feel.BLACK_OFF else Feel.BLACK_ON
                        "fx" -> Feel.EFFECT
                        else -> Feel.MEDIA
                    },
                )
            }
            "buzz" -> haptics?.play(
                when (m.optString("p")) {
                    "time5" -> Feel.TIME_5
                    "time1" -> Feel.TIME_1
                    "timeup" -> Feel.TIME_UP
                    "last" -> Feel.LAST_SLIDE
                    "vidend" -> Feel.VIDEO_END
                    else -> Feel.LOST
                },
            )
            "pair" -> pair.value = PairRequest(m.optString("code"), m.optString("pc"))
        }
    }
}
