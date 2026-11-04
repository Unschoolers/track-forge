package io.trackforge.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onPause() {
        if (getBridge() != null) {
            getBridge().triggerWindowJSEvent("trackforge:pause");
        }
        super.onPause();
    }
}
