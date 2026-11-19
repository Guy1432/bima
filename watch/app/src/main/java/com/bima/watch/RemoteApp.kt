package com.bima.watch

import android.os.SystemClock
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.PagerState
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.HorizontalPageIndicator
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PageIndicatorState
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow

private val Brand = Color(0xFF5D58E6)
private val Live = Color(0xFFEF4444)
private val Warn = Color(0xFFF59E0B)
private val Muted = Color(0xFF9A9AA6)
private val Surface = Color(0xFF26262E)
private val Track = Color(0x22FFFFFF)

private val Tabular = TextStyle(fontFeatureSettings = "tnum")

/** id, emoji, label — the same effects as the computer's effects menu */
private val EFFECTS = listOf(
    Triple("confetti", "🎊", "קונפטי"),
    Triple("tada", "🎉", "טה-דה"),
    Triple("applause", "👏", "כפיים"),
    Triple("drumroll", "🥁", "תופים"),
    Triple("correct", "✅", "נכון"),
    Triple("wrong", "❌", "טעות"),
    Triple("hearts", "❤️", "לבבות"),
    Triple("fireworks", "🎆", "זיקוקים"),
)

private const val CONTROL = 0
private const val VIDEO = 1
private const val PAGES = 4

private fun clock(sec: Long): String {
    val s = kotlin.math.abs(sec)
    val h = s / 3600
    val m = (s % 3600) / 60
    val ss = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, ss) else "%d:%02d".format(m, ss)
}

/** What the clock shows: time left (or over) when a talk length is set, else time so far. */
private data class Time(val text: String, val color: Color, val progress: Float?)

private fun timeOf(show: Show, elapsed: Long): Time {
    if (show.target <= 0) return Time(clock(elapsed), Color.White, null)
    val left = show.target - elapsed
    return when {
        // LRM keeps the sign on the left of the digits in a Hebrew layout
        left < 0 -> Time("‎+" + clock(-left), Live, 1f)
        left <= 60 -> Time(clock(left), Live, elapsed.toFloat() / show.target)
        left <= 300 -> Time(clock(left), Warn, elapsed.toFloat() / show.target)
        else -> Time(clock(left), Color.White, elapsed.toFloat() / show.target)
    }
}

@Composable
fun RemoteApp(missingPermission: StateFlow<Boolean>, onGrant: () -> Unit) {
    val link by RemoteHub.link.collectAsState()
    val pair by RemoteHub.pair.collectAsState()
    val noPermission by missingPermission.collectAsState()

    MaterialTheme {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            Box(Modifier.fillMaxSize().background(Color.Black), contentAlignment = Alignment.Center) {
                when {
                    noPermission -> Message("צריך הרשאת Bluetooth", "כדי שבימה תתחבר לשעון.", "אישור", onGrant)
                    pair != null -> PairPrompt(pair!!)
                    link == Link.CONNECTED -> Pages()
                    link == Link.NO_BLUETOOTH -> Message("Bluetooth כבוי", "הפעל אותו בהגדרות השעון.")
                    link == Link.UNSUPPORTED -> Message("השעון לא נתמך", "אין בו תמיכה בחיבור לבימה.")
                    else -> Message("מחכה לבימה", "במחשב: סמל השעון בסרגל העליון")
                }
            }
        }
    }
}

/* ------------------------------------------------------------------ layout helpers */

/** The round screen: content is placed by fractions of its diameter, so it fits 40 and 44 mm alike. */
@Composable
private fun Round(content: @Composable BoxScope.(d: Dp) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val d = minOf(maxWidth, maxHeight)
        content(d)
    }
}

/** at a fraction of the diameter from the top, centred */
private fun BoxScope.at(y: Dp): Modifier = Modifier.align(Alignment.TopCenter).offset(y = y)

@Composable
private fun px(d: Dp, f: Float): TextUnit = with(LocalDensity.current) { (d * f).toSp() }

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Circle(
    size: Dp,
    color: Color,
    modifier: Modifier = Modifier,
    onLong: (() -> Unit)? = null,
    onClick: () -> Unit,
    content: @Composable () -> Unit,
) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(color)
            .combinedClickable(onClick = onClick, onLongClick = onLong),
        contentAlignment = Alignment.Center,
    ) { content() }
}

private enum class G { FORWARD, BACK, PLAY, PAUSE, CHECK, CROSS, SCREEN }

/** Small vector glyphs, drawn so they look the same on every watch. FORWARD points left (Hebrew). */
@Composable
private fun Glyph(g: G, size: Dp, color: Color = Color.White) {
    Canvas(Modifier.size(size)) {
        val w = this.size.width
        val s = Stroke(width = w * 0.13f, cap = StrokeCap.Round, join = StrokeJoin.Round)
        when (g) {
            G.FORWARD -> drawPath(Path().apply { moveTo(w * 0.62f, w * 0.2f); lineTo(w * 0.32f, w * 0.5f); lineTo(w * 0.62f, w * 0.8f) }, color, style = s)
            G.BACK -> drawPath(Path().apply { moveTo(w * 0.38f, w * 0.2f); lineTo(w * 0.68f, w * 0.5f); lineTo(w * 0.38f, w * 0.8f) }, color, style = s)
            G.PLAY -> drawPath(Path().apply { moveTo(w * 0.28f, w * 0.16f); lineTo(w * 0.86f, w * 0.5f); lineTo(w * 0.28f, w * 0.84f); close() }, color)
            G.PAUSE -> {
                drawRoundRect(color, Offset(w * 0.22f, w * 0.16f), androidx.compose.ui.geometry.Size(w * 0.2f, w * 0.68f), androidx.compose.ui.geometry.CornerRadius(w * 0.05f))
                drawRoundRect(color, Offset(w * 0.58f, w * 0.16f), androidx.compose.ui.geometry.Size(w * 0.2f, w * 0.68f), androidx.compose.ui.geometry.CornerRadius(w * 0.05f))
            }
            G.CHECK -> drawPath(Path().apply { moveTo(w * 0.2f, w * 0.52f); lineTo(w * 0.42f, w * 0.74f); lineTo(w * 0.82f, w * 0.3f) }, color, style = s)
            // the projected screen, filled: blackout
            G.SCREEN -> drawRoundRect(color, Offset(w * 0.08f, w * 0.2f), androidx.compose.ui.geometry.Size(w * 0.84f, w * 0.6f), androidx.compose.ui.geometry.CornerRadius(w * 0.1f))
            G.CROSS -> {
                drawLine(color, Offset(w * 0.25f, w * 0.25f), Offset(w * 0.75f, w * 0.75f), s.width, StrokeCap.Round)
                drawLine(color, Offset(w * 0.75f, w * 0.25f), Offset(w * 0.25f, w * 0.75f), s.width, StrokeCap.Round)
            }
        }
    }
}

/** The talk's progress around the rim of the screen. */
@Composable
private fun Rim(time: Time) {
    val p = time.progress ?: return
    CircularProgressIndicator(
        progress = p.coerceIn(0f, 1f),
        modifier = Modifier.fillMaxSize().padding(2.dp),
        indicatorColor = if (time.color == Color.White) Brand else time.color,
        trackColor = Track,
        strokeWidth = 4.dp,
    )
}

/* ------------------------------------------------------------------ not connected */

@Composable
private fun Message(title: String, body: String, action: String? = null, onAction: (() -> Unit)? = null) {
    Round { d ->
        Column(
            Modifier.align(Alignment.Center).width(d * 0.74f),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            Text(body, fontSize = 12.sp, color = Muted, textAlign = TextAlign.Center)
            if (action != null && onAction != null) {
                Spacer(Modifier.height(4.dp))
                Box(
                    Modifier.height(40.dp).width(d * 0.5f).clip(RoundedCornerShape(20.dp)).background(Brand)
                        .combinedClickableCompat(onAction),
                    contentAlignment = Alignment.Center,
                ) { Text(action, fontWeight = FontWeight.SemiBold) }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableCompat(onClick: () -> Unit) = this.combinedClickable(onClick = onClick)

@Composable
private fun PairPrompt(req: PairRequest) {
    Round { d ->
        Text("לחבר לבימה?", at(d * 0.14f), fontSize = 14.sp, color = Muted)
        Text(
            req.code,
            at(d * 0.24f),
            fontSize = px(d, 0.17f),
            fontWeight = FontWeight.Bold,
            letterSpacing = 3.sp,
            style = Tabular,
        )
        Text(
            req.pc,
            at(d * 0.46f).width(d * 0.7f),
            fontSize = 12.sp,
            color = Muted,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Row(at(d * 0.62f), horizontalArrangement = Arrangement.spacedBy(d * 0.08f)) {
            // RTL: confirm on the right, under the thumb
            Circle(d * 0.24f, Brand, onClick = { RemoteHub.answerPair(true) }) { Glyph(G.CHECK, d * 0.11f) }
            Circle(d * 0.24f, Surface, onClick = { RemoteHub.answerPair(false) }) { Glyph(G.CROSS, d * 0.09f) }
        }
    }
}

/* ------------------------------------------------------------------ connected */

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Pages() {
    val show by RemoteHub.show.collectAsState()
    val pager = rememberPagerState(pageCount = { PAGES })

    // a slide with a video: straight to the player; leaving it: back to the main control
    LaunchedEffect(show.item, show.index) {
        if (show.media && pager.currentPage != VIDEO) pager.animateScrollToPage(VIDEO)
        else if (!show.media && pager.currentPage == VIDEO) pager.animateScrollToPage(CONTROL)
    }

    Box(Modifier.fillMaxSize()) {
        HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
            when (page) {
                CONTROL -> ControlPage()
                VIDEO -> VideoPage()
                2 -> EffectsPage()
                else -> TimePage()
            }
        }
        HorizontalPageIndicator(
            pageIndicatorState = remember(pager) { PagerIndicator(pager) },
            selectedColor = Color.White,
            unselectedColor = Color(0xFF55555F),
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
private class PagerIndicator(private val pager: PagerState) : PageIndicatorState {
    override val pageOffset: Float get() = pager.currentPageOffsetFraction
    override val selectedPage: Int get() = pager.currentPage
    override val pageCount: Int get() = pager.pageCount
}

/** ticks once a second so the show clock runs between Bima's updates */
@Composable
private fun rememberNow(): Long {
    var now by remember { mutableLongStateOf(SystemClock.elapsedRealtime()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            now = SystemClock.elapsedRealtime()
        }
    }
    return now
}

/** slide n/total and the clock, the first thing the eye lands on */
@Composable
private fun Status(show: Show, time: Time, modifier: Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(if (show.projector) Live else Color(0xFF55555F)))
        Text(if (show.total > 0) "${show.index}/${show.total}" else "—", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, style = Tabular)
        Text(time.text, fontSize = 15.sp, color = if (time.color == Color.White) Muted else time.color, style = Tabular)
    }
}

@Composable
private fun ControlPage() {
    val show by RemoteHub.show.collectAsState()
    val time = timeOf(show, show.elapsedNow(rememberNow()))
    val blacked = show.blackout != "none"
    val last = show.total > 0 && show.next == "סוף ההצגה"

    Round { d ->
        Rim(time)
        Status(show, time, at(d * 0.1f))
        Text(
            when {
                blacked -> if (show.blackout == "white") "מסך לבן" else "המסך מוחשך"
                else -> show.next.ifBlank { show.item }
            },
            at(d * 0.19f).width(d * 0.66f),
            fontSize = 12.sp,
            color = if (blacked) Live else Muted,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        // the one big target
        Circle(d * 0.42f, if (last) Surface else Brand, at(d * 0.27f), onClick = { RemoteHub.command("next") }) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Glyph(G.FORWARD, d * 0.13f)
                Text("הבא", fontSize = px(d, 0.075f), fontWeight = FontWeight.Bold)
            }
        }
        Row(at(d * 0.71f), horizontalArrangement = Arrangement.spacedBy(d * 0.06f)) {
            Circle(d * 0.2f, Surface, onClick = { RemoteHub.command("prev") }) { Glyph(G.BACK, d * 0.09f) }
            // tap: black screen · long-press: white screen
            Circle(
                d * 0.2f,
                if (blacked) Color.White else Surface,
                onLong = { RemoteHub.command("white") },
                onClick = { RemoteHub.command("black") },
            ) {
                Glyph(G.SCREEN, d * 0.1f, if (blacked) Color.Black else Color.White)
            }
        }
    }
}

@Composable
private fun VideoPage() {
    val show by RemoteHub.show.collectAsState()
    Round { d ->
        // moving on doesn't need a swipe back
        Row(
            at(d * 0.1f).height(d * 0.14f).clip(RoundedCornerShape(50)).background(Surface)
                .combinedClickableCompat { RemoteHub.command("next") }
                .padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Text("הבא", fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Glyph(G.FORWARD, d * 0.07f)
        }
        if (!show.media) {
            Text(
                "אין סרטון בשקופית",
                Modifier.align(Alignment.Center).width(d * 0.6f),
                fontSize = 13.sp,
                color = Muted,
                textAlign = TextAlign.Center,
            )
            return@Round
        }
        Circle(d * 0.42f, Brand, at(d * 0.27f), onClick = { RemoteHub.command("media", "toggle") }) {
            Glyph(if (show.playing) G.PAUSE else G.PLAY, d * 0.15f)
        }
        // a timeline runs left to right in any language
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Ltr) {
            Row(at(d * 0.71f), horizontalArrangement = Arrangement.spacedBy(d * 0.06f)) {
                Circle(d * 0.2f, Surface, onClick = { RemoteHub.command("media", "back10") }) {
                    Text("−10", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, style = Tabular)
                }
                Circle(d * 0.2f, Surface, onClick = { RemoteHub.command("media", "fwd10") }) {
                    Text("+10", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, style = Tabular)
                }
            }
        }
    }
}

@Composable
private fun EffectsPage() {
    Round { d ->
        ScalingLazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(top = d * 0.12f, bottom = d * 0.16f),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            item { Text("אפקטים", fontSize = 13.sp, color = Muted) }
            items(EFFECTS.chunked(2)) { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(d * 0.07f)) {
                    for ((id, emoji, label) in row) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Circle(d * 0.25f, Surface, onClick = { RemoteHub.command("fx", id) }) {
                                Text(emoji, fontSize = px(d, 0.11f))
                            }
                            Text(label, fontSize = 11.sp, color = Muted, modifier = Modifier.padding(top = 3.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TimePage() {
    val show by RemoteHub.show.collectAsState()
    val elapsed = show.elapsedNow(rememberNow())
    val time = timeOf(show, elapsed)
    var hint by remember { mutableStateOf(false) }
    LaunchedEffect(hint) {
        if (hint) {
            delay(1800)
            hint = false
        }
    }
    val over = show.target > 0 && elapsed > show.target

    Round { d ->
        Rim(time)
        Text(
            when {
                show.target <= 0 -> "זמן"
                over -> "חריגה"
                else -> "נשאר"
            },
            at(d * 0.2f),
            fontSize = 13.sp,
            color = Muted,
        )
        Text(time.text, at(d * 0.3f), fontSize = px(d, 0.2f), fontWeight = FontWeight.Bold, color = time.color, style = Tabular)
        if (show.target > 0) {
            Text("מתוך ${clock(show.target)}", at(d * 0.56f), fontSize = 12.sp, color = Muted, style = Tabular)
        }
        // a reset mid-talk would be costly: it takes a long press
        Box(
            at(d * 0.7f).height(d * 0.15f).width(d * 0.42f).clip(RoundedCornerShape(50)).background(Surface)
                .combinedClickableLong(onClick = { hint = true }, onLong = { RemoteHub.command("clock", "reset") }),
            contentAlignment = Alignment.Center,
        ) {
            Text(if (hint) "לחיצה ארוכה" else "איפוס", fontSize = 13.sp, color = if (hint) Muted else Color.White)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
private fun Modifier.combinedClickableLong(onClick: () -> Unit, onLong: () -> Unit) =
    this.combinedClickable(onClick = onClick, onLongClick = onLong)
