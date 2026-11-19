package com.bima.watch

import android.os.SystemClock
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.runtime.CompositionLocalProvider
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.ListHeader
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow

private val Brand = Color(0xFF5D58E6)
private val Live = Color(0xFFEF4444)
private val Muted = Color(0xFF9A9AA6)
private val Surface = Color(0xFF1E1E24)

private val EFFECTS = listOf(
    "confetti" to "קונפטי",
    "drumroll" to "תופים",
    "applause" to "כפיים",
    "tada" to "טה-דה",
    "correct" to "נכון",
    "wrong" to "טעות",
    "hearts" to "לבבות",
    "fireworks" to "זיקוקים",
)

private fun clock(sec: Long): String {
    val s = maxOf(0, sec)
    val h = s / 3600
    val m = (s % 3600) / 60
    val ss = s % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, ss) else "%d:%02d".format(m, ss)
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
                    noPermission -> Message("צריך הרשאת Bluetooth", "כדי שבימה במחשב תוכל להתחבר לשעון.", "אישור", onGrant)
                    pair != null -> PairPrompt(pair!!)
                    link == Link.CONNECTED -> Pages()
                    link == Link.NO_BLUETOOTH -> Message("Bluetooth כבוי", "הפעל Bluetooth בהגדרות השעון.")
                    link == Link.UNSUPPORTED -> Message("השעון לא תומך", "השעון הזה לא מאפשר לבימה להתחבר אליו.")
                    else -> Message("מחכה לבימה", "במחשב: הגדרות ← שליטה ← שעון")
                }
            }
        }
    }
}

@Composable
private fun Message(title: String, body: String, action: String? = null, onAction: (() -> Unit)? = null) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(body, fontSize = 12.sp, color = Muted, textAlign = TextAlign.Center)
        if (action != null && onAction != null) {
            Spacer(Modifier.height(4.dp))
            Button(onClick = onAction, colors = ButtonDefaults.buttonColors(backgroundColor = Brand), modifier = Modifier.width(110.dp).height(40.dp)) {
                Text(action)
            }
        }
    }
}

@Composable
private fun PairPrompt(req: PairRequest) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("לחבר לבימה?", fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        Text(req.pc, fontSize = 12.sp, color = Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(req.code, fontSize = 30.sp, fontWeight = FontWeight.Bold, letterSpacing = 4.sp)
        Text("ודא שזה הקוד שמוצג במחשב", fontSize = 11.sp, color = Muted)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(onClick = { RemoteHub.answerPair(false) }, colors = ButtonDefaults.secondaryButtonColors(), modifier = Modifier.size(52.dp)) {
                Text("ביטול", fontSize = 12.sp)
            }
            Button(onClick = { RemoteHub.answerPair(true) }, colors = ButtonDefaults.buttonColors(backgroundColor = Brand), modifier = Modifier.size(52.dp)) {
                Text("חיבור", fontSize = 12.sp)
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Pages() {
    val pager = rememberPagerState(pageCount = { 4 })
    Box(Modifier.fillMaxSize()) {
        HorizontalPager(state = pager, modifier = Modifier.fillMaxSize()) { page ->
            when (page) {
                0 -> ControlPage()
                1 -> EffectsPage()
                2 -> VideoPage()
                else -> TimePage()
            }
        }
        Row(
            Modifier.align(Alignment.BottomCenter).padding(bottom = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(5.dp),
        ) {
            repeat(4) { i ->
                Box(Modifier.size(5.dp).clip(CircleShape).background(if (pager.currentPage == i) Color.White else Color(0xFF4A4A55)))
            }
        }
    }
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ControlPage() {
    val show by RemoteHub.show.collectAsState()
    val now = rememberNow()
    val elapsed = show.elapsedNow(now)
    val blacked = show.blackout != "none"

    Column(
        Modifier.fillMaxSize().padding(top = 22.dp, bottom = 18.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        // status: slide · time
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(6.dp).clip(CircleShape).background(if (show.projector) Live else Muted))
            Text(if (show.total > 0) "${show.index}/${show.total}" else "—", fontSize = 13.sp, fontWeight = FontWeight.Medium)
            Text(
                if (show.target > 0) clock(show.target - elapsed) else clock(elapsed),
                fontSize = 13.sp,
                color = if (show.target > 0 && show.target - elapsed <= 60) Live else Muted,
            )
        }

        // the one big target
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Button(
                onClick = { RemoteHub.command("next") },
                colors = ButtonDefaults.buttonColors(backgroundColor = Brand),
                modifier = Modifier.size(96.dp),
            ) {
                Text("הבא", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
            Text(
                when {
                    blacked -> "המסך מוחשך"
                    show.next.isNotBlank() -> show.next
                    else -> show.item
                },
                fontSize = 11.sp,
                color = if (blacked) Live else Muted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 4.dp, start = 30.dp, end = 30.dp),
            )
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Pill("חזרה", active = false) { RemoteHub.command("prev") }
            // tap: black screen · long-press: white screen
            Pill("השחרה", active = blacked, onLong = { RemoteHub.command("white") }) { RemoteHub.command("black") }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun Pill(label: String, active: Boolean, onLong: (() -> Unit)? = null, onClick: () -> Unit) {
    Box(
        Modifier
            .width(64.dp)
            .height(36.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(if (active) Color.White else Surface)
            .combinedClickable(onClick = onClick, onLongClick = onLong),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, fontSize = 13.sp, color = if (active) Color.Black else Color.White, fontWeight = FontWeight.Medium)
    }
}

@Composable
private fun EffectsPage() {
    ScalingLazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 24.dp),
    ) {
        item { ListHeader { Text("אפקטים") } }
        items(EFFECTS) { (id, label) ->
            Chip(
                onClick = { RemoteHub.command("fx", id) },
                label = { Text(label) },
                colors = ChipDefaults.secondaryChipColors(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun VideoPage() {
    val show by RemoteHub.show.collectAsState()
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("סרטון", fontSize = 13.sp, color = Muted)
        if (!show.media) {
            Text("אין סרטון בשקופית", fontSize = 13.sp, color = Muted)
            return@Column
        }
        Button(
            onClick = { RemoteHub.command("media", "toggle") },
            colors = ButtonDefaults.buttonColors(backgroundColor = Brand),
            modifier = Modifier.size(80.dp),
        ) {
            Text(if (show.playing) "השהיה" else "ניגון", fontSize = 15.sp, fontWeight = FontWeight.Bold)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Pill("‎-10", active = false) { RemoteHub.command("media", "back10") }
            Pill("‎+10", active = false) { RemoteHub.command("media", "fwd10") }
        }
    }
}

@Composable
private fun TimePage() {
    val show by RemoteHub.show.collectAsState()
    val now = rememberNow()
    val elapsed = show.elapsedNow(now)
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(if (show.target > 0) "נשאר" else "משך", fontSize = 13.sp, color = Muted)
        Text(
            if (show.target > 0) clock(show.target - elapsed) else clock(elapsed),
            fontSize = 34.sp,
            fontWeight = FontWeight.Bold,
            color = if (show.target > 0 && show.target - elapsed <= 60) Live else Color.White,
        )
        if (show.target > 0) Text("עבר ${clock(elapsed)}", fontSize = 12.sp, color = Muted)
        Spacer(Modifier.height(6.dp))
        Pill("איפוס", active = false) { RemoteHub.command("clock", "reset") }
    }
}
