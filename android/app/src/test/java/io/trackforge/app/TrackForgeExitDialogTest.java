package io.trackforge.app;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.Dialog;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.TextView;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(manifest = Config.NONE, sdk = 35)
public class TrackForgeExitDialogTest {
    @Test public void stayDismissesWithoutQuitting() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        AtomicInteger exits = new AtomicInteger();
        Dialog dialog = TrackForgeExitDialog.create(activity, exits::incrementAndGet);
        dialog.show();

        TextView title = dialog.findViewById(R.id.exit_dialog_title);
        assertEquals(activity.getString(R.string.exit_track_forge_title), title.getText().toString());
        assertTrue(dialog.getWindow().getAttributes().dimAmount >= 0.8f);
        assertEquals(WindowManager.LayoutParams.WRAP_CONTENT, dialog.getWindow().getAttributes().height);

        Button stay = dialog.findViewById(R.id.exit_dialog_stay);
        stay.performClick();

        assertFalse(dialog.isShowing());
        assertEquals(0, exits.get());
    }

    @Test public void exitQuitsExactlyOnce() {
        Activity activity = Robolectric.buildActivity(Activity.class).setup().get();
        AtomicInteger exits = new AtomicInteger();
        Dialog dialog = TrackForgeExitDialog.create(activity, exits::incrementAndGet);
        dialog.show();

        View exit = dialog.findViewById(R.id.exit_dialog_confirm);
        exit.performClick();
        assertFalse(dialog.isShowing());
        assertEquals(1, exits.get());
    }
}
