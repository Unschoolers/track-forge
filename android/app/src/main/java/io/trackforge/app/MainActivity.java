package io.trackforge.app;

import android.app.Dialog;
import android.content.Intent;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private Dialog exitDialog;
    private boolean backEvaluationPending;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(TrackExportPlugin.class);
        registerPlugin(NearbyRacePlugin.class);
        registerPlugin(LanRacePlugin.class);
        registerPlugin(TrackForgeUpdatesPlugin.class);
        registerPlugin(TrackForgeAppPlugin.class);
        TrackExportPlugin.captureIncomingTrackIntent(getIntent());
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleSystemBack();
            }
        });
        enterImmersiveMode();
    }

    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (TrackExportPlugin.captureIncomingTrackIntent(intent) && getBridge() != null) {
            getBridge().triggerWindowJSEvent("trackforge:incoming-track");
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        enterImmersiveMode();
        if (getBridge() != null) {
            getBridge().triggerWindowJSEvent("trackforge:resume");
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enterImmersiveMode();
        }
    }

    @Override
    public void onPause() {
        if (getBridge() != null) {
            getBridge().triggerWindowJSEvent("trackforge:pause");
        }
        super.onPause();
    }

    /**
     * Android Back navigates the in-game UI first. JavaScript synchronously
     * prevents the cancelable event when it handled Back; otherwise Android
     * displays a native confirmation if the web UI cannot handle Back.
     */
    private void handleSystemBack() {
        if (backEvaluationPending || (exitDialog != null && exitDialog.isShowing())) return;

        if (getBridge() == null || getBridge().getWebView() == null) {
            showExitConfirmation();
            return;
        }

        backEvaluationPending = true;
        getBridge().getWebView().evaluateJavascript(
            "(() => { const back = new Event('trackforge:android-back', { cancelable: true }); return !window.dispatchEvent(back); })()",
            handled -> {
                backEvaluationPending = false;
                if (!"true".equals(handled)) showExitConfirmation();
            }
        );
    }

    private void showExitConfirmation() {
        if (isFinishing() || isDestroyed() || (exitDialog != null && exitDialog.isShowing())) return;

        exitDialog = TrackForgeExitDialog.create(this, this::finish);
        exitDialog.setOnDismissListener(dialog -> exitDialog = null);
        exitDialog.show();
    }

    @Override
    public void onDestroy() {
        if (exitDialog != null) {
            exitDialog.dismiss();
            exitDialog = null;
        }
        super.onDestroy();
    }

    private void enterImmersiveMode() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
