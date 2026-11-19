package com.bima.watch

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/**
 * The remote's vocabulary of touch, so the presenter knows what happened without looking.
 * Every pattern is distinct by rhythm, not only by strength.
 */
enum class Feel {
    NEXT, // one crisp tick
    PREV, // two quick ticks
    BLACK_ON, // a deep thud
    BLACK_OFF, // a light tick
    EFFECT, // a rising swell
    MEDIA, // a click
    FAILED, // three short buzzes: Bima didn't confirm
    LOST, // three long buzzes: the link to Bima is gone
    LINKED, // two soft rises: connected
    TIME_5, // two long pulses: five minutes left
    TIME_1, // three long pulses: one minute left
    TIME_UP, // one very long pulse and two short
    LAST_SLIDE, // long then short
    VIDEO_END, // a falling tick pair
}

class Haptics(context: Context) {
    private val vibrator: Vibrator =
        if (Build.VERSION.SDK_INT >= 31) (context.getSystemService(VibratorManager::class.java)).defaultVibrator
        else @Suppress("DEPRECATION") context.getSystemService(Vibrator::class.java)

    private fun supported(vararg p: Int) = vibrator.areAllPrimitivesSupported(*p)

    private fun compose(vararg steps: Triple<Int, Float, Int>): VibrationEffect? {
        if (!supported(*steps.map { it.first }.toIntArray())) return null
        val c = VibrationEffect.startComposition()
        for ((p, scale, delay) in steps) c.addPrimitive(p, scale, delay)
        return c.compose()
    }

    private fun wave(vararg timings: Long) = VibrationEffect.createWaveform(longArrayOf(0, *timings), -1)

    private val click = VibrationEffect.Composition.PRIMITIVE_CLICK
    private val tick = VibrationEffect.Composition.PRIMITIVE_TICK
    private val rise = VibrationEffect.Composition.PRIMITIVE_QUICK_RISE
    private val fall = VibrationEffect.Composition.PRIMITIVE_QUICK_FALL
    private val thud = if (Build.VERSION.SDK_INT >= 31) VibrationEffect.Composition.PRIMITIVE_THUD else click

    fun play(feel: Feel) {
        val effect = when (feel) {
            Feel.NEXT -> compose(Triple(click, 1f, 0)) ?: wave(30)
            Feel.PREV -> compose(Triple(click, 0.9f, 0), Triple(click, 0.9f, 70)) ?: wave(25, 70, 25)
            Feel.BLACK_ON -> compose(Triple(thud, 1f, 0)) ?: wave(90)
            Feel.BLACK_OFF -> compose(Triple(tick, 1f, 0)) ?: wave(20)
            Feel.EFFECT -> compose(Triple(rise, 1f, 0), Triple(click, 0.7f, 40)) ?: wave(60, 40, 30)
            Feel.MEDIA -> compose(Triple(click, 0.8f, 0)) ?: wave(25)
            Feel.LINKED -> compose(Triple(rise, 0.6f, 0), Triple(rise, 0.8f, 120)) ?: wave(40, 100, 40)
            Feel.VIDEO_END -> compose(Triple(fall, 1f, 0), Triple(tick, 1f, 60)) ?: wave(50, 60, 20)
            Feel.FAILED -> wave(70, 70, 70, 70, 70)
            Feel.LOST -> wave(400, 150, 400, 150, 400)
            Feel.TIME_5 -> wave(350, 200, 350)
            Feel.TIME_1 -> wave(300, 150, 300, 150, 300)
            Feel.TIME_UP -> wave(900, 200, 120, 120, 120)
            Feel.LAST_SLIDE -> wave(350, 150, 80)
        }
        vibrator.vibrate(effect)
    }
}
