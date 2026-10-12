package com.homehub.companion

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.*
import android.widget.*
import androidx.webkit.WebMessageCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.Locale

class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var status: TextView
    private lateinit var enable: Button
    private val engine: WakeWordEngine = UnavailableWakeWordEngine()
    private var voiceEnabled = false
    private var foreground = false
    private var recognizer: SpeechRecognizer? = null
    private var requestId: String? = null
    private var reply: JavaScriptReplyProxy? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var speaking = false
    private var chooser: ValueCallback<Array<Uri>>? = null
    private val handler = Handler(Looper.getMainLooper())
    private val timeout = Runnable { stopListening() }
    private fun trusted(uri: Uri?) = uri != null && uri.scheme == "https" && uri.host == "theoldstar26.github.io" && uri.port in listOf(-1,443) && uri.userInfo == null && uri.path?.startsWith("/homehub-app/") == true
    private fun send(type: String, id: String? = requestId, text: String? = null, error: String? = null) {
        if (!foreground || !trusted(Uri.parse(web.url ?: ""))) return
        val m = JSONObject().put("version",1).put("type",type)
        if(id!=null)m.put("id",id)
        if(text!=null)m.put("text",text)
        if(error!=null)m.put("error",error)
        reply?.postMessage(m.toString())
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply { orientation=LinearLayout.VERTICAL }
        status = TextView(this).apply { text="Microphone OFF · Hey HomeHub not installed"; textSize=18f; setTextColor(Color.BLACK); setPadding(16,12,16,12) }
        enable = Button(this).apply { text="Enable tap-to-talk (on-device only)"; setOnClickListener {
            if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED) requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO),10) else enableVoice()
        } }
        val stop = Button(this).apply { text="Stop Listening / Disable Voice"; setOnClickListener { disableVoice() } }
        layout.addView(status);layout.addView(enable);layout.addView(stop)
        web=WebView(this)
        layout.addView(web,LinearLayout.LayoutParams(-1,0,1f));setContentView(layout)
        web.settings.apply { javaScriptEnabled=true; domStorageEnabled=true; allowFileAccess=false; allowContentAccess=false; mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW; setSupportMultipleWindows(false) }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false)
        WebView.setWebContentsDebuggingEnabled(false)
        web.webViewClient=object: WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = !trusted(request.url)
            override fun onPageStarted(view: WebView, url: String, favicon: android.graphics.Bitmap?) {
                stopListening();tts?.stop();speaking=false;reply=null
                if(!trusted(Uri.parse(url))) {view.stopLoading();status.text="Blocked navigation outside HomeHub"}
            }
            override fun onReceivedSslError(view: WebView, h: SslErrorHandler, error: android.net.http.SslError) {h.cancel();disableVoice();status.text="Secure connection failed"}
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {if(request.isForMainFrame){disableVoice();status.text="HomeHub failed to load. Reopen when online."}}
        }
        web.webChromeClient=object: WebChromeClient() {
            // Voice uses native recognizer. Never grant raw web microphone/camera access.
            override fun onPermissionRequest(request: PermissionRequest) {request.deny()}
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                chooser?.onReceiveValue(null);chooser=callback
                return try {startActivityForResult(params.createIntent(),20);true} catch(_:Exception){chooser=null;callback.onReceiveValue(null);true}
            }
        }
        if(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addWebMessageListener(web,"HomeHubNative",setOf("https://theoldstar26.github.io")) { _, message, origin, mainFrame, proxy ->
                if(!foreground || !mainFrame || origin.toString()!="https://theoldstar26.github.io" || !trusted(Uri.parse(web.url ?: ""))) return@addWebMessageListener
                if(message.type != WebMessageCompat.TYPE_STRING)return@addWebMessageListener
                val raw=message.data ?: return@addWebMessageListener
                if(raw.length>12000)return@addWebMessageListener
                try {
                    val m=JSONObject(raw);if(m.optInt("version")!=1)return@addWebMessageListener
                    reply=proxy
                    when(m.optString("type")) {
                        "ready" -> Unit
                        "listen" -> { val id=m.optString("id");if(id.matches(Regex("[0-9]{1,10}")))listenOnce(id) }
                        "stop" -> if(m.optString("id")==requestId)stopListening()
                        "cancelSpeech" -> {tts?.stop();speaking=false}
                        "speak" -> {val text=m.optString("text");if(voiceEnabled && text.isNotBlank() && text.length<=10000)speak(text)}
                    }
                }catch(_:Exception){ /* Malformed or unsupported messages cannot invoke native actions. */ }
            }
            WebViewCompat.addDocumentStartJavaScript(web,assets.open("voice-adapter.js").bufferedReader().use {it.readText()},setOf("https://theoldstar26.github.io"))
        } else {enable.isEnabled=false;status.text="Voice unavailable: update Android System WebView"}
        tts=TextToSpeech(this) { result ->
            ttsReady=result==TextToSpeech.SUCCESS
            if(ttsReady){val language=tts?.setLanguage(Locale.UK);ttsReady=language!=TextToSpeech.LANG_MISSING_DATA && language!=TextToSpeech.LANG_NOT_SUPPORTED;tts?.setOnUtteranceProgressListener(object:UtteranceProgressListener(){
                override fun onStart(id:String) {}
                override fun onDone(id:String) {runOnUiThread{speaking=false;send("speechEnd");updateStatus()}}
                @Deprecated("Required platform callback") override fun onError(id:String) {runOnUiThread{speaking=false;send("speechError");updateStatus()}}
            })}
        }
        web.loadUrl("https://theoldstar26.github.io/homehub-app/")
    }
    private fun updateStatus(){status.text=when{speaking->"Microphone OFF · Speaking";requestId!=null->"Microphone ACTIVE · Listening to your question";voiceEnabled->"Microphone OFF · Tap-to-talk ready · Wake engine unavailable";else->"Microphone OFF · Voice disabled"}}
    private fun enableVoice(){
        if(android.os.Build.VERSION.SDK_INT<31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(this)){status.text="Microphone OFF · On-device speech recognition unavailable; use Chrome tap-to-talk";return}
        voiceEnabled=true;enable.text="Voice enabled · microphone off";updateStatus()
    }
    private fun listenOnce(id:String){
        if(!voiceEnabled || !foreground || speaking || checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){send("error",id,error="not-allowed");send("end",id);return}
        if(requestId!=null){send("error",id,error="aborted");send("end",id);return}
        if(android.os.Build.VERSION.SDK_INT<31){send("error",id,error="service-not-allowed");send("end",id);return}
        engine.stop();requestId=id
        try {
            recognizer=SpeechRecognizer.createOnDeviceSpeechRecognizer(this)
            recognizer?.setRecognitionListener(object:RecognitionListener {
                override fun onReadyForSpeech(params:Bundle?){updateStatus()}
                override fun onBeginningOfSpeech(){}
                override fun onRmsChanged(rmsdB:Float){}
                override fun onBufferReceived(buffer:ByteArray?){}
                override fun onEndOfSpeech(){}
                override fun onError(error:Int){send("error",error=if(error==SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS)"not-allowed" else "no-speech");stopListening()}
                override fun onResults(results:Bundle?){val text=results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull();if(!text.isNullOrBlank() && text.length<=1000)send("result",text=text);stopListening()}
                override fun onPartialResults(partialResults:Bundle?){}
                override fun onEvent(eventType:Int,params:Bundle?){}
            })
            recognizer?.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM).putExtra(RecognizerIntent.EXTRA_LANGUAGE,"en-GB"))
            handler.postDelayed(timeout,20000);updateStatus()
        }catch(_:Exception){send("error",error="service-not-allowed");stopListening()}
    }
    private fun stopListening(){handler.removeCallbacks(timeout);engine.stop();val old=requestId;requestId=null;recognizer?.cancel();recognizer?.destroy();recognizer=null;if(old!=null)send("end",old);updateStatus()}
    private fun speak(text:String){stopListening();if(!ttsReady){send("speechError");return};speaking=true;updateStatus();if(tts?.speak(text,TextToSpeech.QUEUE_FLUSH,null,"homehub")==TextToSpeech.ERROR){speaking=false;send("speechError");updateStatus()}}
    private fun disableVoice(){voiceEnabled=false;stopListening();tts?.stop();speaking=false;enable.text="Enable tap-to-talk (on-device only)";updateStatus()}
    override fun onRequestPermissionsResult(code:Int, permissions:Array<out String>, results:IntArray){super.onRequestPermissionsResult(code,permissions,results);if(code==10 && foreground){if(results.firstOrNull()==PackageManager.PERMISSION_GRANTED)enableVoice() else status.text="Microphone permission denied · microphone OFF"}}
    override fun onActivityResult(code:Int,result:Int,data:Intent?){super.onActivityResult(code,result,data);if(code==20){chooser?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));chooser=null}}
    override fun onResume(){super.onResume();foreground=true;web.onResume()}
    override fun onPause(){disableVoice();foreground=false;web.onPause();CookieManager.getInstance().flush();super.onPause()}
    override fun onDestroy(){disableVoice();engine.close();tts?.shutdown();chooser?.onReceiveValue(null);web.destroy();super.onDestroy()}
    @Deprecated("Legacy Activity back callback") override fun onBackPressed(){if(web.canGoBack())web.goBack() else super.onBackPressed()}
}
