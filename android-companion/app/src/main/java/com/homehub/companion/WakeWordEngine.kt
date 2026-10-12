package com.homehub.companion

/** Future engine owns local AudioRecord capture. It must never upload ambient audio.
 * start is called only after foreground consent and permission, and never during TTS.
 * stop releases the microphone immediately; preserve a short local pre-roll to avoid
 * clipping a question spoken immediately after Hey HomeHub. */
interface WakeWordEngine : AutoCloseable {
    val available: Boolean
    fun start(onWake: () -> Unit, onError: (String) -> Unit)
    fun stop()
    override fun close()
}
class UnavailableWakeWordEngine : WakeWordEngine {
    override val available = false
    override fun start(onWake: () -> Unit, onError: (String) -> Unit) { onError("Offline wake-word engine is not installed. Microphone remains off.") }
    override fun stop() {}
    override fun close() {}
}
